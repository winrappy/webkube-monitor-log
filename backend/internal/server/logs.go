package server

import (
	"bufio"
	"context"
	"fmt"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

func getLogsCached(ctx context.Context, state *appState, namespace, kind, name, search string, sinceMinutes uint32, start, end, ctxName *string) ([]LogEntry, error) {
	sinceMinutes = normalizeSinceMinutes(sinceMinutes, maxLogSinceMin)
	cacheKey := fmt.Sprintf("%s|%s|%s|%s|%s", namespace, kind, name, contextCacheKey(ctxName), timeRangeKey(sinceMinutes, start, end))
	now := time.Now()
	state.cache.mu.RLock()
	if entry, ok := state.cache.logs[cacheKey]; ok && entry.expiresAt.After(now) {
		state.cache.mu.RUnlock()
		return filterAndSortLogs(entry.value, search), nil
	}
	state.cache.mu.RUnlock()

	entries, err := fetchLogs(ctx, namespace, kind, name, "", sinceMinutes, start, end, ctxName)
	if err != nil {
		return nil, err
	}
	state.cache.mu.Lock()
	prune(state.cache.logs, now)
	if len(state.cache.logs) >= logCacheMaxEntries {
		var oldestKey string
		var oldest time.Time
		for key, entry := range state.cache.logs {
			if oldestKey == "" || entry.expiresAt.Before(oldest) {
				oldestKey, oldest = key, entry.expiresAt
			}
		}
		delete(state.cache.logs, oldestKey)
	}
	state.cache.logs[cacheKey] = cacheEntry[[]LogEntry]{value: entries, expiresAt: now.Add(logCacheTTL)}
	state.cache.mu.Unlock()
	return filterAndSortLogs(entries, search), nil
}

func fetchLogs(ctx context.Context, namespace, kind, name, search string, sinceMinutes uint32, start, end, ctxName *string) ([]LogEntry, error) {
	sinceMinutes = normalizeSinceMinutes(sinceMinutes, maxLogSinceMin)
	if namespace == "" || kind == "" || name == "" {
		return nil, status(http.StatusBadRequest, fmt.Errorf("missing workload query"))
	}
	client, snap, err := clientAndSnapshot(ctx, namespace, kind, name, ctxName)
	if err != nil {
		return nil, err
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelsToSelector(snap.selector)})
	if err != nil {
		return nil, status(http.StatusBadGateway, err)
	}

	term := strings.ToLower(search)
	var entries []LogEntry
	for _, pod := range pods.Items {
		entries = append(entries, logsForPod(ctx, client, namespace, pod, term, sinceMinutes, start, end)...)
	}
	sort.Slice(entries, func(i, j int) bool {
		return newerFirst(entries[i].Timestamp, entries[j].Timestamp, entries[i].Source, entries[j].Source)
	})
	return entries, nil
}

type logSendFunc func(LogEntry) error

func streamLiveLogs(ctx context.Context, namespace, kind, name, search string, sinceMinutes uint32, start, end, ctxName *string, send logSendFunc) error {
	sinceMinutes = normalizeSinceMinutes(sinceMinutes, maxLogSinceMin)
	if namespace == "" || kind == "" || name == "" {
		return status(http.StatusBadRequest, fmt.Errorf("missing workload query"))
	}
	client, snap, err := clientAndSnapshot(ctx, namespace, kind, name, ctxName)
	if err != nil {
		return err
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelsToSelector(snap.selector)})
	if err != nil {
		return status(http.StatusBadGateway, err)
	}

	entries := make(chan LogEntry, 256)
	var wg sync.WaitGroup
	term := strings.ToLower(search)
	for _, pod := range pods.Items {
		if !podHasRunningContainer(pod) {
			continue
		}
		wg.Add(1)
		go func(pod corev1.Pod) {
			defer wg.Done()
			streamPodLogs(ctx, client, namespace, pod.Name, "pod/"+pod.Name, liveLogOptions(sinceMinutes, start), term, end, entries)
		}(pod)
	}
	go func() {
		wg.Wait()
		close(entries)
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		case entry, ok := <-entries:
			if !ok {
				return nil
			}
			if err := send(entry); err != nil {
				return err
			}
		}
	}
}

func logsForPod(ctx context.Context, client *kubernetes.Clientset, namespace string, pod corev1.Pod, search string, sinceMinutes uint32, start, end *string) []LogEntry {
	var entries []LogEntry
	var restartCount int32
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.RestartCount > restartCount {
			restartCount = cs.RestartCount
		}
	}
	if podHasRunningContainer(pod) {
		opts := boundedPodLogOptions()
		if start != nil {
			if t, err := time.Parse(time.RFC3339, *start); err == nil {
				metatime := metav1.NewTime(t)
				opts.SinceTime = &metatime
			}
		} else {
			seconds := int64(normalizeSinceMinutes(sinceMinutes, maxLogSinceMin)) * 60
			opts.SinceSeconds = &seconds
		}
		entries = append(entries, readPodLog(ctx, client, namespace, pod.Name, "pod/"+pod.Name, opts, search, end)...)
	}
	if restartCount > 0 {
		opts := boundedPodLogOptions()
		opts.Previous = true
		entries = append(entries, readPodLog(ctx, client, namespace, pod.Name, "pod/"+pod.Name+"/previous", opts, search, end)...)
	}
	return entries
}

func podHasRunningContainer(pod corev1.Pod) bool {
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Running != nil {
			return true
		}
	}
	return false
}

func liveLogOptions(sinceMinutes uint32, start *string) *corev1.PodLogOptions {
	opts := boundedPodLogOptions()
	opts.Follow = true
	if start != nil {
		if t, err := time.Parse(time.RFC3339, *start); err == nil {
			metatime := metav1.NewTime(t)
			opts.SinceTime = &metatime
			return opts
		}
	}
	seconds := int64(normalizeSinceMinutes(sinceMinutes, maxLogSinceMin)) * 60
	opts.SinceSeconds = &seconds
	return opts
}

func boundedPodLogOptions() *corev1.PodLogOptions {
	tailLines := int64(maxPodLogTailLines)
	limitBytes := int64(maxPodLogBytes)
	return &corev1.PodLogOptions{
		Timestamps: true,
		TailLines:  &tailLines,
		LimitBytes: &limitBytes,
	}
}

func streamPodLogs(ctx context.Context, client *kubernetes.Clientset, namespace, podName, source string, opts *corev1.PodLogOptions, search string, end *string, entries chan<- LogEntry) {
	stream, err := client.CoreV1().Pods(namespace).GetLogs(podName, opts).Stream(ctx)
	if err != nil {
		return
	}
	defer stream.Close()

	var endTime *time.Time
	if end != nil {
		if t, err := time.Parse(time.RFC3339, *end); err == nil {
			endTime = &t
		}
	}
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		ts, line := splitTimestampedLogLine(scanner.Text())
		if search != "" && !strings.Contains(strings.ToLower(line), search) {
			continue
		}
		if ts != nil && endTime != nil {
			if parsed, err := time.Parse(time.RFC3339Nano, *ts); err == nil && parsed.After(*endTime) {
				return
			}
		}
		select {
		case <-ctx.Done():
			return
		case entries <- LogEntry{Source: source, Line: line, Timestamp: ts}:
		}
	}
}

func readPodLog(ctx context.Context, client *kubernetes.Clientset, namespace, podName, source string, opts *corev1.PodLogOptions, search string, end *string) []LogEntry {
	stream, err := client.CoreV1().Pods(namespace).GetLogs(podName, opts).Stream(ctx)
	if err != nil {
		return nil
	}
	defer stream.Close()

	var endTime *time.Time
	if end != nil {
		if t, err := time.Parse(time.RFC3339, *end); err == nil {
			endTime = &t
		}
	}
	var entries []LogEntry
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		ts, line := splitTimestampedLogLine(scanner.Text())
		if search != "" && !strings.Contains(strings.ToLower(line), search) {
			continue
		}
		if ts != nil && endTime != nil {
			if parsed, err := time.Parse(time.RFC3339Nano, *ts); err == nil && parsed.After(*endTime) {
				continue
			}
		}
		entries = append(entries, LogEntry{Source: source, Line: line, Timestamp: ts})
	}
	return entries
}

func timeRangeKey(sinceMinutes uint32, start, end *string) string {
	if start != nil || end != nil {
		left, right := "", ""
		if start != nil {
			left = *start
		}
		if end != nil {
			right = *end
		}
		return "custom:" + left + ":" + right
	}
	return fmt.Sprintf("since:%d", sinceMinutes)
}

func filterAndSortLogs(entries []LogEntry, search string) []LogEntry {
	out := make([]LogEntry, 0, len(entries))
	term := strings.ToLower(search)
	for _, entry := range entries {
		if term == "" || strings.Contains(strings.ToLower(entry.Line), term) {
			out = append(out, entry)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return newerFirst(out[i].Timestamp, out[j].Timestamp, out[i].Source, out[j].Source)
	})
	return out
}

func newerFirst(left, right *string, leftName, rightName string) bool {
	if left != nil && right != nil {
		return *left > *right
	}
	if left != nil {
		return true
	}
	if right != nil {
		return false
	}
	return leftName < rightName
}

func olderFirst(left, right *string, leftName, rightName string) bool {
	if left != nil && right != nil {
		return *left < *right
	}
	if left != nil {
		return true
	}
	if right != nil {
		return false
	}
	return leftName < rightName
}

func splitTimestampedLogLine(line string) (*string, string) {
	prefix, rest, ok := strings.Cut(line, " ")
	if ok && strings.Contains(prefix, "T") && (strings.HasSuffix(prefix, "Z") || strings.Contains(prefix, "+")) {
		return &prefix, rest
	}
	return nil, line
}
