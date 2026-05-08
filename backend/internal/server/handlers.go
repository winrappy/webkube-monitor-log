package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
)

func handleWorkloads(state *appState, w http.ResponseWriter, r *http.Request) error {
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		return status(http.StatusBadRequest, fmt.Errorf("missing namespace"))
	}
	ctxName := optionalQuery(r, "context")
	items, err := listWorkloadsCached(r.Context(), state, namespace, ctxName)
	if err != nil {
		return err
	}
	return writeJSON(w, items)
}

func handleLogs(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	entries, err := getLogsCached(r.Context(), state, q.Get("namespace"), q.Get("kind"), q.Get("name"), q.Get("search"), parseSinceMinutes(q.Get("since_minutes"), maxLogSinceMin), optionalQuery(r, "start_time"), optionalQuery(r, "end_time"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, entries)
}

func handleLogStream(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	entries, err := fetchLogs(r.Context(), q.Get("namespace"), q.Get("kind"), q.Get("name"), q.Get("search"), parseSinceMinutes(q.Get("since_minutes"), maxLogSinceMin), optionalQuery(r, "start_time"), optionalQuery(r, "end_time"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	for _, entry := range entries {
		data, _ := json.Marshal(entry)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
	}
	return nil
}

func handleGlobalLogSearch(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	namespace := q.Get("namespace")
	search := q.Get("search")
	sinceMinutes := parseSinceMinutes(q.Get("since_minutes"), maxFanoutSinceMin)
	if namespace == "" || search == "" {
		return writeJSON(w, []GlobalLogEntry{})
	}
	workloads, err := listWorkloadsCached(r.Context(), state, namespace, optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	type result struct {
		entries []GlobalLogEntry
	}
	sem := make(chan struct{}, 5)
	results := make(chan result, len(workloads))
	var wg sync.WaitGroup
	for _, workload := range workloads {
		wg.Add(1)
		go func(wl WorkloadItem) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			logs, err := getLogsCached(r.Context(), state, namespace, wl.Kind, wl.Name, "", sinceMinutes, nil, nil, optionalQuery(r, "context"))
			if err != nil {
				return
			}
			term := strings.ToLower(search)
			var matched []GlobalLogEntry
			for _, entry := range logs {
				if strings.Contains(strings.ToLower(entry.Line), term) {
					matched = append(matched, GlobalLogEntry{WorkloadKind: wl.Kind, WorkloadName: wl.Name, Source: entry.Source, Line: entry.Line, Timestamp: entry.Timestamp})
				}
			}
			results <- result{entries: matched}
		}(workload)
	}
	wg.Wait()
	close(results)

	var all []GlobalLogEntry
	for res := range results {
		all = append(all, res.entries...)
	}
	sort.Slice(all, func(i, j int) bool {
		return newerFirst(all[i].Timestamp, all[j].Timestamp, all[i].WorkloadName, all[j].WorkloadName)
	})
	return writeJSON(w, all)
}

func handleRequestChain(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	namespace := q.Get("namespace")
	query := strings.TrimSpace(q.Get("query"))
	if query == "" {
		query = strings.TrimSpace(q.Get("correlation_id"))
	}
	mode := strings.TrimSpace(q.Get("mode"))
	if mode == "" {
		mode = inferRequestChainMode(query)
	}
	sinceMinutes := parseSinceMinutes(q.Get("since_minutes"), maxFanoutSinceMin)
	if namespace == "" {
		return status(http.StatusBadRequest, fmt.Errorf("missing namespace"))
	}
	if query == "" {
		return writeJSON(w, RequestChain{CorrelationID: query, Query: query, Mode: mode})
	}

	workloads, err := listWorkloadsCached(r.Context(), state, namespace, optionalQuery(r, "context"))
	if err != nil {
		return err
	}

	sem := make(chan struct{}, 5)
	results := make(chan []RequestChainItem, len(workloads))
	var wg sync.WaitGroup
	for _, workload := range workloads {
		wg.Add(1)
		go func(wl WorkloadItem) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			logs, err := getLogsCached(r.Context(), state, namespace, wl.Kind, wl.Name, "", sinceMinutes, nil, nil, optionalQuery(r, "context"))
			if err != nil {
				return
			}

			matched := make([]RequestChainItem, 0)
			for index, entry := range logs {
				traceInfo := extractTraceInfo(entry.Line)
				if !matchesRequestChainQuery(entry.Line, traceInfo, query, mode) {
					continue
				}
				eventType, target, confidence := inferChainEvent(entry.Line)
				if mode == "trace" || traceInfo.Trace != nil {
					confidence = "high"
				}
				matched = append(matched, RequestChainItem{
					ID:           fmt.Sprintf("%s/%s/%d", wl.Kind, wl.Name, index),
					WorkloadKind: wl.Kind,
					WorkloadName: wl.Name,
					Source:       entry.Source,
					Timestamp:    entry.Timestamp,
					EventType:    eventType,
					Target:       target,
					Confidence:   confidence,
					Trace:        traceInfo.Trace,
					TraceID:      traceInfo.TraceID,
					SpanID:       traceInfo.SpanID,
					Line:         entry.Line,
				})
			}
			results <- matched
		}(workload)
	}
	wg.Wait()
	close(results)

	items := make([]RequestChainItem, 0)
	for matched := range results {
		items = append(items, matched...)
	}
	sort.Slice(items, func(i, j int) bool {
		return olderFirst(items[i].Timestamp, items[j].Timestamp, items[i].WorkloadName, items[j].WorkloadName)
	})

	return writeJSON(w, RequestChain{
		CorrelationID: query,
		Query:         query,
		Mode:          mode,
		Items:         items,
		Edges:         inferRequestChainEdges(items),
		Summary:       requestChainSummary(items),
	})
}

func handleEnv(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	client, snap, err := clientAndSnapshot(r.Context(), q.Get("namespace"), q.Get("kind"), q.Get("name"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	vars := make([]EnvVar, 0)
	for _, c := range snap.containers {
		for _, e := range c.Env {
			vars = append(vars, EnvVar{Container: c.Name, Name: e.Name, Value: envValue(e)})
		}
		for _, from := range c.EnvFrom {
			vars = append(vars, fetchEnvFrom(r.Context(), client, q.Get("namespace"), c.Name, from)...)
		}
	}
	sort.Slice(vars, func(i, j int) bool {
		if vars[i].Container == vars[j].Container {
			return vars[i].Name < vars[j].Name
		}
		return vars[i].Container < vars[j].Container
	})
	return writeJSON(w, vars)
}

func handlePodStatus(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	items, err := podStatuses(r.Context(), q.Get("namespace"), q.Get("kind"), q.Get("name"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, items)
}

func handleTimeline(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	timeline, err := workloadTimeline(r.Context(), q.Get("namespace"), q.Get("kind"), q.Get("name"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, timeline)
}

func handleDiagnostics(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	diagnostics, err := crashDiagnostics(r.Context(), q.Get("namespace"), q.Get("kind"), q.Get("name"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, diagnostics)
}

func handleMetrics(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	metrics, err := workloadMetrics(r.Context(), q.Get("namespace"), q.Get("kind"), q.Get("name"), optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, metrics)
}

func handleWorkloadSpec(state *appState, w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	namespace, kind, name := q.Get("namespace"), q.Get("kind"), q.Get("name")
	client, err := kubeClient(optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	spec, err := workloadSpec(r.Context(), client, namespace, kind, name)
	if err != nil {
		return err
	}
	return writeJSON(w, WorkloadSpecItem{Kind: kind, Name: name, Namespace: namespace, Spec: spec})
}

func handleServiceMap(state *appState, w http.ResponseWriter, r *http.Request) error {
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		return status(http.StatusBadRequest, fmt.Errorf("missing namespace"))
	}
	serviceMap, err := buildServiceMap(r.Context(), state, namespace, optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, serviceMap)
}
