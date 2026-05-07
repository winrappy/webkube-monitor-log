package server

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func podStatuses(ctx context.Context, namespace, kind, name string, ctxName *string) ([]PodStatusItem, error) {
	client, snap, err := clientAndSnapshot(ctx, namespace, kind, name, ctxName)
	if err != nil {
		return nil, err
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelsToSelector(snap.selector)})
	if err != nil {
		return nil, status(http.StatusBadGateway, err)
	}
	items := make([]PodStatusItem, 0, len(pods.Items))
	for _, pod := range pods.Items {
		ready, total := 0, len(pod.Status.ContainerStatuses)
		var restarts int32
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.Ready {
				ready++
			}
			restarts += cs.RestartCount
		}
		phase := string(pod.Status.Phase)
		if phase == "" {
			phase = "Unknown"
		}
		items = append(items, PodStatusItem{Name: pod.Name, Phase: phase, Ready: fmt.Sprintf("%d/%d", ready, total), Restarts: restarts})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

func workloadTimeline(ctx context.Context, namespace, kind, name string, ctxName *string) (PodTimeline, error) {
	client, snap, err := clientAndSnapshot(ctx, namespace, kind, name, ctxName)
	if err != nil {
		return PodTimeline{}, err
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelsToSelector(snap.selector)})
	if err != nil {
		return PodTimeline{}, status(http.StatusBadGateway, err)
	}
	podNames := map[string]bool{}
	for _, pod := range pods.Items {
		podNames[pod.Name] = true
	}
	events, err := client.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return PodTimeline{}, status(http.StatusBadGateway, err)
	}
	items := make([]PodEvent, 0)
	for _, event := range events.Items {
		if event.InvolvedObject.Kind != "Pod" || !podNames[event.InvolvedObject.Name] {
			continue
		}
		ts := event.LastTimestamp.Time
		if ts.IsZero() {
			ts = event.EventTime.Time
		}
		if ts.IsZero() {
			ts = event.FirstTimestamp.Time
		}
		items = append(items, PodEvent{
			EventType: event.Type,
			Reason:    event.Reason,
			Source:    "pod/" + event.InvolvedObject.Name,
			Message:   event.Message,
			Timestamp: formatOptionalTime(ts),
			Count:     event.Count,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Timestamp > items[j].Timestamp })
	return PodTimeline{Events: items}, nil
}

func crashDiagnostics(ctx context.Context, namespace, kind, name string, ctxName *string) (CrashDiagnostics, error) {
	client, snap, err := clientAndSnapshot(ctx, namespace, kind, name, ctxName)
	if err != nil {
		return CrashDiagnostics{}, err
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelsToSelector(snap.selector)})
	if err != nil {
		return CrashDiagnostics{}, status(http.StatusBadGateway, err)
	}
	var items []CrashDiagnostic
	for _, pod := range pods.Items {
		if pod.Status.Phase == corev1.PodFailed || pod.Status.Phase == corev1.PodPending {
			items = append(items, CrashDiagnostic{
				Pod:      pod.Name,
				Severity: severityForPodPhase(pod.Status.Phase),
				Reason:   string(pod.Status.Phase),
				Message:  firstPodConditionMessage(pod),
			})
		}
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.RestartCount > 0 {
				items = append(items, CrashDiagnostic{
					Pod:       pod.Name,
					Container: cs.Name,
					Severity:  "warning",
					Reason:    "Restarted",
					Message:   fmt.Sprintf("container restarted %d time(s)", cs.RestartCount),
					Restarts:  cs.RestartCount,
				})
			}
			if cs.State.Waiting != nil {
				items = append(items, CrashDiagnostic{
					Pod:       pod.Name,
					Container: cs.Name,
					Severity:  severityForReason(cs.State.Waiting.Reason),
					Reason:    cs.State.Waiting.Reason,
					Message:   cs.State.Waiting.Message,
					Restarts:  cs.RestartCount,
				})
			}
			if cs.LastTerminationState.Terminated != nil {
				term := cs.LastTerminationState.Terminated
				items = append(items, CrashDiagnostic{
					Pod:       pod.Name,
					Container: cs.Name,
					Severity:  severityForExit(term.ExitCode, term.Reason),
					Reason:    fallback(term.Reason, fmt.Sprintf("ExitCode%d", term.ExitCode)),
					Message:   fallback(term.Message, fmt.Sprintf("last terminated with exit code %d", term.ExitCode)),
					Restarts:  cs.RestartCount,
				})
			}
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Severity == items[j].Severity {
			return items[i].Pod < items[j].Pod
		}
		return severityRank(items[i].Severity) < severityRank(items[j].Severity)
	})
	return CrashDiagnostics{Items: items}, nil
}

func workloadMetrics(ctx context.Context, namespace, kind, name string, ctxName *string) (WorkloadMetrics, error) {
	restConfig, err := kubeRESTConfig(ctxName)
	if err != nil {
		return WorkloadMetrics{}, status(http.StatusServiceUnavailable, err)
	}
	client, snap, err := clientAndSnapshot(ctx, namespace, kind, name, ctxName)
	if err != nil {
		return WorkloadMetrics{}, err
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelsToSelector(snap.selector)})
	if err != nil {
		return WorkloadMetrics{}, status(http.StatusBadGateway, err)
	}
	podNames := map[string]bool{}
	for _, pod := range pods.Items {
		podNames[pod.Name] = true
	}
	metricsClient, err := metricsclient.NewForConfig(restConfig)
	if err != nil {
		return WorkloadMetrics{Available: false, Message: err.Error()}, nil
	}
	list, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return WorkloadMetrics{Available: false, Message: err.Error()}, nil
	}
	var items []ContainerMetric
	for _, podMetric := range list.Items {
		if !podNames[podMetric.Name] {
			continue
		}
		for _, container := range podMetric.Containers {
			items = append(items, ContainerMetric{
				Pod:             podMetric.Name,
				Container:       container.Name,
				CPUUsageNano:    quantityNano(container.Usage[corev1.ResourceCPU]),
				MemoryUsageByte: quantityValue(container.Usage[corev1.ResourceMemory]),
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Pod == items[j].Pod {
			return items[i].Container < items[j].Container
		}
		return items[i].Pod < items[j].Pod
	})
	return WorkloadMetrics{Available: true, Items: items}, nil
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func severityForPodPhase(phase corev1.PodPhase) string {
	if phase == corev1.PodFailed {
		return "critical"
	}
	return "warning"
}

func severityForReason(reason string) string {
	switch reason {
	case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "RunContainerError":
		return "critical"
	case "ContainerCreating", "PodInitializing":
		return "info"
	default:
		return "warning"
	}
}

func severityForExit(exitCode int32, reason string) string {
	if exitCode == 0 || reason == "Completed" {
		return "info"
	}
	if reason == "OOMKilled" || exitCode == 137 {
		return "critical"
	}
	return "warning"
}

func severityRank(severity string) int {
	switch severity {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

func firstPodConditionMessage(pod corev1.Pod) string {
	for _, condition := range pod.Status.Conditions {
		if condition.Status != corev1.ConditionTrue && condition.Message != "" {
			return condition.Message
		}
	}
	return string(pod.Status.Phase)
}

func fallback(value, replacement string) string {
	if value == "" {
		return replacement
	}
	return value
}

func quantityNano(value resource.Quantity) int64 {
	return value.MilliValue() * 1_000_000
}

func quantityValue(value resource.Quantity) int64 {
	return value.Value()
}
