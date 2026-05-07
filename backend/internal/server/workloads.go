package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listWorkloadsCached(ctx context.Context, state *appState, namespace string, ctxName *string) ([]WorkloadItem, error) {
	cacheKey := namespace + "|" + contextCacheKey(ctxName)
	now := time.Now()
	state.cache.mu.RLock()
	if entry, ok := state.cache.workloads[cacheKey]; ok && entry.expiresAt.After(now) {
		state.cache.mu.RUnlock()
		return entry.value, nil
	}
	state.cache.mu.RUnlock()

	client, err := kubeClient(ctxName)
	if err != nil {
		return nil, err
	}
	items, err := listWorkloads(ctx, client, namespace)
	if err != nil {
		return nil, err
	}
	state.cache.mu.Lock()
	prune(state.cache.workloads, now)
	state.cache.workloads[cacheKey] = cacheEntry[[]WorkloadItem]{value: items, expiresAt: now.Add(apiCacheTTL)}
	state.cache.mu.Unlock()
	return items, nil
}

func listWorkloads(ctx context.Context, client *kubernetes.Clientset, namespace string) ([]WorkloadItem, error) {
	items := make([]WorkloadItem, 0)
	deployments, err := client.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, status(http.StatusBadGateway, err)
	}
	for _, item := range deployments.Items {
		if len(item.Spec.Selector.MatchLabels) > 0 {
			items = append(items, WorkloadItem{Kind: "Deployment", Name: item.Name, Namespace: namespace, Selector: item.Spec.Selector.MatchLabels})
		}
	}
	statefulSets, err := client.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, status(http.StatusBadGateway, err)
	}
	for _, item := range statefulSets.Items {
		if len(item.Spec.Selector.MatchLabels) > 0 {
			items = append(items, WorkloadItem{Kind: "StatefulSet", Name: item.Name, Namespace: namespace, Selector: item.Spec.Selector.MatchLabels})
		}
	}
	daemonSets, err := client.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, status(http.StatusBadGateway, err)
	}
	for _, item := range daemonSets.Items {
		if len(item.Spec.Selector.MatchLabels) > 0 {
			items = append(items, WorkloadItem{Kind: "DaemonSet", Name: item.Name, Namespace: namespace, Selector: item.Spec.Selector.MatchLabels})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}
