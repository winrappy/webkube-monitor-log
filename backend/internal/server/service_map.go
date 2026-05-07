package server

import (
	"context"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sort"
	"strings"
)

func buildServiceMap(ctx context.Context, state *appState, namespace string, ctxName *string) (ServiceMap, error) {
	workloads, err := listWorkloadsCached(ctx, state, namespace, ctxName)
	if err != nil {
		return ServiceMap{}, err
	}
	client, err := kubeClient(ctxName)
	if err != nil {
		return ServiceMap{}, err
	}

	nodes := make([]ServiceMapNode, 0, len(workloads))
	selectorOwners := map[string]string{}
	for _, workload := range workloads {
		statuses, _ := podStatuses(ctx, namespace, workload.Kind, workload.Name, ctxName)
		node := ServiceMapNode{ID: nodeID(workload.Kind, workload.Name), Kind: workload.Kind, Name: workload.Name, Health: "unknown", TotalPods: len(statuses)}
		for _, ps := range statuses {
			ready, total := parseReady(ps.Ready)
			node.ReadyPods += ready
			if total == 0 && ps.Phase == "Running" {
				node.ReadyPods++
			}
			node.RestartCount += ps.Restarts
		}
		node.Health = healthFor(node)
		nodes = append(nodes, node)
		for k, v := range workload.Selector {
			selectorOwners[k+"="+v] = node.ID
		}
	}

	var edges []ServiceMapEdge
	services, _ := client.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	for _, svc := range services.Items {
		target := ownerForSelector(selectorOwners, svc.Spec.Selector)
		if target == "" {
			continue
		}
		for _, from := range workloads {
			if fromID := nodeID(from.Kind, from.Name); fromID != target {
				edges = append(edges, ServiceMapEdge{Source: fromID, Target: target, Type: "service-selector"})
			}
		}
	}

	ingresses, _ := client.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	serviceTargets := serviceTargetMap(services, selectorOwners)
	for _, ing := range ingresses.Items {
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				target := serviceTargets[path.Backend.Service.Name]
				for _, from := range workloads {
					if target != "" && nodeID(from.Kind, from.Name) != target {
						edges = append(edges, ServiceMapEdge{Source: nodeID(from.Kind, from.Name), Target: target, Type: "ingress"})
					}
				}
			}
		}
	}

	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	return ServiceMap{Nodes: nodes, Edges: uniqueEdges(edges)}, nil
}

func nodeID(kind, name string) string {
	return kind + "/" + name
}

func parseReady(value string) (int, int) {
	left, right, ok := strings.Cut(value, "/")
	if !ok {
		return 0, 0
	}
	ready, _ := strconv.Atoi(left)
	total, _ := strconv.Atoi(right)
	return ready, total
}

func healthFor(node ServiceMapNode) string {
	if node.TotalPods == 0 {
		return "unknown"
	}
	if node.RestartCount > 0 {
		return "degraded"
	}
	if node.ReadyPods == node.TotalPods {
		return "healthy"
	}
	if node.ReadyPods == 0 {
		return "failing"
	}
	return "degraded"
}

func ownerForSelector(owners map[string]string, selector map[string]string) string {
	for key, value := range selector {
		if owner := owners[key+"="+value]; owner != "" {
			return owner
		}
	}
	return ""
}

func serviceTargetMap(services *corev1.ServiceList, owners map[string]string) map[string]string {
	targets := map[string]string{}
	if services == nil {
		return targets
	}
	for _, svc := range services.Items {
		if target := ownerForSelector(owners, svc.Spec.Selector); target != "" {
			targets[svc.Name] = target
		}
	}
	return targets
}

func uniqueEdges(edges []ServiceMapEdge) []ServiceMapEdge {
	seen := map[string]bool{}
	var out []ServiceMapEdge
	for _, edge := range edges {
		key := edge.Source + "|" + edge.Target + "|" + edge.Type
		if edge.Source == edge.Target || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, edge)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Source == out[j].Source {
			return out[i].Target < out[j].Target
		}
		return out[i].Source < out[j].Source
	})
	return out
}
