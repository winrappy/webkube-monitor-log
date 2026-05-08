package server

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func inferChainEvent(line string) (string, *string, string) {
	lower := strings.ToLower(line)

	if strings.Contains(lower, "kafka") {
		target := extractKafkaTarget(line)
		if strings.Contains(lower, "publish") || strings.Contains(lower, "produce") || strings.Contains(lower, "producer") || strings.Contains(lower, "send") {
			return "kafka-publish", target, confidenceForTarget(target)
		}
		if strings.Contains(lower, "consume") || strings.Contains(lower, "consumer") || strings.Contains(lower, "received") || strings.Contains(lower, "poll") {
			return "kafka-consume", target, confidenceForTarget(target)
		}
		return "kafka", target, confidenceForTarget(target)
	}

	if target := extractHTTPTarget(line); target != nil {
		if strings.Contains(lower, "calling") || strings.Contains(lower, "call ") || strings.Contains(lower, "request to") || strings.Contains(lower, "outbound") || strings.Contains(lower, "client") || strings.Contains(lower, "http://") || strings.Contains(lower, "https://") {
			return "http-call", target, "medium"
		}
		return "http-request", target, "medium"
	}

	if strings.Contains(lower, "request") || strings.Contains(lower, "handler") || strings.Contains(lower, "controller") {
		return "request-log", nil, "low"
	}
	return "log", nil, "low"
}

func extractKafkaTarget(line string) *string {
	if match := topicPattern.FindStringSubmatch(line); len(match) == 2 {
		return ptr("kafka:" + strings.Trim(match[1], ".,;"))
	}
	return ptr("kafka")
}

func extractHTTPTarget(line string) *string {
	if match := httpURLPattern.FindString(line); match != "" {
		return ptr(strings.Trim(match, ".,;"))
	}
	if match := pathPattern.FindStringSubmatch(line); len(match) == 2 {
		return ptr(strings.Trim(match[1], ".,;"))
	}
	return nil
}

func confidenceForTarget(target *string) string {
	if target == nil || *target == "kafka" {
		return "low"
	}
	return "medium"
}

type traceInfo struct {
	Trace   *string
	TraceID *string
	SpanID  *string
}

func inferRequestChainMode(query string) string {
	lower := strings.ToLower(query)
	if strings.Contains(lower, "traces/") || isLikelyTraceID(query) {
		return "trace"
	}
	return "correlation"
}

func matchesRequestChainQuery(line string, info traceInfo, query, mode string) bool {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return false
	}
	if mode == "trace" {
		traceID := extractTraceID(query)
		if info.Trace != nil && strings.Contains(strings.ToLower(*info.Trace), needle) {
			return true
		}
		if traceID != "" && info.TraceID != nil && strings.EqualFold(*info.TraceID, traceID) {
			return true
		}
		return false
	}
	if mode == "span" {
		return info.SpanID != nil && strings.EqualFold(*info.SpanID, query)
	}
	return strings.Contains(strings.ToLower(line), needle)
}

func extractTraceInfo(line string) traceInfo {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &payload); err != nil {
		return traceInfo{}
	}
	trace := stringField(payload, "logging.googleapis.com/trace", "trace", "traceId", "trace_id")
	span := stringField(payload, "logging.googleapis.com/spanId", "spanId", "span_id")
	traceID := ""
	if trace != nil {
		traceID = extractTraceID(*trace)
	}
	if traceID == "" && trace != nil && isLikelyTraceID(*trace) {
		traceID = *trace
	}
	return traceInfo{Trace: trace, TraceID: ptrIfNotEmpty(traceID), SpanID: span}
}

func stringField(values map[string]interface{}, keys ...string) *string {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			switch typed := value.(type) {
			case string:
				return ptrIfNotEmpty(typed)
			case fmt.Stringer:
				return ptrIfNotEmpty(typed.String())
			}
		}
	}
	return nil
}

func extractTraceID(value string) string {
	trimmed := strings.TrimSpace(value)
	if match := traceIDPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		return match[1]
	}
	if isLikelyTraceID(trimmed) {
		return trimmed
	}
	return ""
}

func isLikelyTraceID(value string) bool {
	if len(value) != 16 && len(value) != 32 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func ptrIfNotEmpty(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func inferRequestChainEdges(items []RequestChainItem) []RequestChainEdge {
	counts := map[string]int{}
	for _, item := range items {
		source := nodeID(item.WorkloadKind, item.WorkloadName)
		if item.Target != nil && *item.Target != "" {
			key := source + "|" + *item.Target + "|" + item.EventType
			counts[key]++
		}
	}
	for i := 1; i < len(items); i++ {
		prev := nodeID(items[i-1].WorkloadKind, items[i-1].WorkloadName)
		next := nodeID(items[i].WorkloadKind, items[i].WorkloadName)
		if prev != next {
			counts[prev+"|"+next+"|correlation-sequence"]++
		}
	}

	edges := make([]RequestChainEdge, 0, len(counts))
	for key, count := range counts {
		parts := strings.Split(key, "|")
		if len(parts) != 3 {
			continue
		}
		edges = append(edges, RequestChainEdge{Source: parts[0], Target: parts[1], Type: parts[2], Count: count})
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].Source == edges[j].Source {
			return edges[i].Target < edges[j].Target
		}
		return edges[i].Source < edges[j].Source
	})
	return edges
}

func requestChainSummary(items []RequestChainItem) RequestChainSummary {
	workloads := map[string]bool{}
	summary := RequestChainSummary{TotalLogs: len(items)}
	for _, item := range items {
		workloads[nodeID(item.WorkloadKind, item.WorkloadName)] = true
		if strings.HasPrefix(item.EventType, "kafka") {
			summary.Kafka++
		}
		if strings.HasPrefix(item.EventType, "http") || item.EventType == "request-log" {
			summary.HTTP++
		}
	}
	summary.Workloads = len(workloads)
	return summary
}
