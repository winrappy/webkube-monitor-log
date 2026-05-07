package server

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func handleContext(state *appState, w http.ResponseWriter, r *http.Request) error {
	info := getContextInfo(state)
	return writeJSON(w, info)
}

func getContextInfo(state *appState) ContextInfo {
	now := time.Now()
	state.cache.mu.RLock()
	if state.cache.context != nil && state.cache.context.expiresAt.After(now) {
		value := state.cache.context.value
		state.cache.mu.RUnlock()
		return value
	}
	state.cache.mu.RUnlock()

	rawConfig, _ := loadKubeConfig()
	var current, cluster *string
	var contexts []string
	if rawConfig != nil {
		if rawConfig.CurrentContext != "" {
			current = ptr(rawConfig.CurrentContext)
			if named, ok := rawConfig.Contexts[rawConfig.CurrentContext]; ok && named.Cluster != "" {
				cluster = ptr(named.Cluster)
			}
		}
		for name := range rawConfig.Contexts {
			contexts = append(contexts, name)
		}
		sort.Strings(contexts)
	}

	info := ContextInfo{
		KubeContext:   current,
		Cluster:       cluster,
		GcloudProject: readGcloudProject(),
		Contexts:      contexts,
	}
	state.cache.mu.Lock()
	state.cache.context = &cacheEntry[ContextInfo]{value: info, expiresAt: now.Add(apiCacheTTL)}
	state.cache.mu.Unlock()
	return info
}

func handleNamespaces(state *appState, w http.ResponseWriter, r *http.Request) error {
	items, err := listNamespacesCached(r.Context(), state, optionalQuery(r, "context"))
	if err != nil {
		return err
	}
	return writeJSON(w, items)
}

func listNamespacesCached(ctx context.Context, state *appState, ctxName *string) ([]NamespaceItem, error) {
	cacheKey := contextCacheKey(ctxName)
	now := time.Now()
	state.cache.mu.RLock()
	if entry, ok := state.cache.namespaces[cacheKey]; ok && entry.expiresAt.After(now) {
		state.cache.mu.RUnlock()
		return entry.value, nil
	}
	state.cache.mu.RUnlock()

	client, err := kubeClient(ctxName)
	if err != nil {
		return nil, err
	}
	list, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, status(http.StatusBadGateway, err)
	}
	items := make([]NamespaceItem, 0, len(list.Items))
	for _, ns := range list.Items {
		items = append(items, NamespaceItem{Name: ns.Name})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })

	state.cache.mu.Lock()
	prune(state.cache.namespaces, now)
	state.cache.namespaces[cacheKey] = cacheEntry[[]NamespaceItem]{value: items, expiresAt: now.Add(apiCacheTTL)}
	state.cache.mu.Unlock()
	return items, nil
}

func readGcloudProject() *string {
	base := os.Getenv("CLOUDSDK_CONFIG")
	if base == "" {
		base = "/root/.config/gcloud"
	}
	data, err := os.ReadFile(filepath.Join(base, "configurations", "config_default"))
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if value, ok := strings.CutPrefix(line, "project = "); ok {
			return ptr(strings.TrimSpace(value))
		}
	}
	return nil
}
