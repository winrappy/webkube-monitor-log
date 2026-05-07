package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func clientAndSnapshot(ctx context.Context, namespace, kind, name string, ctxName *string) (*kubernetes.Clientset, workloadSnapshot, error) {
	client, err := kubeClient(ctxName)
	if err != nil {
		return nil, workloadSnapshot{}, err
	}
	snap, err := getWorkloadSnapshot(ctx, client, namespace, kind, name)
	if err != nil {
		return nil, workloadSnapshot{}, err
	}
	return client, snap, nil
}

func getWorkloadSnapshot(ctx context.Context, client *kubernetes.Clientset, namespace, kind, name string) (workloadSnapshot, error) {
	switch kind {
	case "Deployment":
		item, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return workloadSnapshot{}, kubeStatus(err)
		}
		return workloadSnapshot{selector: item.Spec.Selector.MatchLabels, containers: item.Spec.Template.Spec.Containers}, nil
	case "StatefulSet":
		item, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return workloadSnapshot{}, kubeStatus(err)
		}
		return workloadSnapshot{selector: item.Spec.Selector.MatchLabels, containers: item.Spec.Template.Spec.Containers}, nil
	case "DaemonSet":
		item, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return workloadSnapshot{}, kubeStatus(err)
		}
		return workloadSnapshot{selector: item.Spec.Selector.MatchLabels, containers: item.Spec.Template.Spec.Containers}, nil
	default:
		return workloadSnapshot{}, status(http.StatusBadRequest, fmt.Errorf("unsupported workload kind"))
	}
}

func workloadSpec(ctx context.Context, client *kubernetes.Clientset, namespace, kind, name string) (interface{}, error) {
	switch kind {
	case "Deployment":
		item, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, kubeStatus(err)
		}
		return item.Spec, nil
	case "StatefulSet":
		item, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, kubeStatus(err)
		}
		return item.Spec, nil
	case "DaemonSet":
		item, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, kubeStatus(err)
		}
		return item.Spec, nil
	default:
		return nil, status(http.StatusBadRequest, fmt.Errorf("unsupported workload kind"))
	}
}

func kubeClient(ctxName *string) (*kubernetes.Clientset, error) {
	config, err := kubeRESTConfig(ctxName)
	if err != nil {
		return nil, status(http.StatusServiceUnavailable, err)
	}
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, status(http.StatusServiceUnavailable, err)
	}
	return client, nil
}

func kubeRESTConfig(ctxName *string) (*rest.Config, error) {
	rawConfig, err := loadKubeConfig()
	if err != nil {
		return rest.InClusterConfig()
	}
	if ctxName != nil {
		rawConfig.CurrentContext = *ctxName
	}
	for _, authInfo := range rawConfig.AuthInfos {
		if authInfo.Exec != nil && authInfo.Exec.Command != "" {
			authInfo.Exec.Command = filepath.Base(authInfo.Exec.Command)
		}
	}
	return clientcmd.NewDefaultClientConfig(*rawConfig, &clientcmd.ConfigOverrides{}).ClientConfig()
}

func loadKubeConfig() (*clientcmdapi.Config, error) {
	path := os.Getenv("KUBECONFIG")
	if path == "" {
		path = "/root/.kube/config"
	}
	return clientcmd.LoadFromFile(path)
}

func fetchEnvFrom(ctx context.Context, client *kubernetes.Clientset, namespace, container string, from corev1.EnvFromSource) []EnvVar {
	prefix := from.Prefix
	if from.ConfigMapRef != nil && from.ConfigMapRef.Name != "" {
		cm, err := client.CoreV1().ConfigMaps(namespace).Get(ctx, from.ConfigMapRef.Name, metav1.GetOptions{})
		if err != nil {
			return nil
		}
		keys := make([]string, 0, len(cm.Data))
		for key := range cm.Data {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		var vars []EnvVar
		for _, key := range keys {
			vars = append(vars, EnvVar{Container: container, Name: prefix + key, Value: cm.Data[key]})
		}
		return vars
	}
	if from.SecretRef != nil && from.SecretRef.Name != "" {
		secret, err := client.CoreV1().Secrets(namespace).Get(ctx, from.SecretRef.Name, metav1.GetOptions{})
		if err != nil {
			return nil
		}
		keys := make([]string, 0, len(secret.Data))
		for key := range secret.Data {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		var vars []EnvVar
		for _, key := range keys {
			vars = append(vars, EnvVar{Container: container, Name: prefix + key, Value: string(secret.Data[key])})
		}
		return vars
	}
	return nil
}

func envValue(env corev1.EnvVar) string {
	if env.Value != "" {
		return env.Value
	}
	if env.ValueFrom == nil {
		return ""
	}
	from := env.ValueFrom
	if from.ConfigMapKeyRef != nil {
		return fmt.Sprintf("(configMap: %s/%s)", from.ConfigMapKeyRef.Name, from.ConfigMapKeyRef.Key)
	}
	if from.SecretKeyRef != nil {
		return fmt.Sprintf("(secret: %s/%s)", from.SecretKeyRef.Name, from.SecretKeyRef.Key)
	}
	if from.FieldRef != nil {
		return "(fieldRef)"
	}
	return "(valueFrom)"
}

func labelsToSelector(labels map[string]string) string {
	parts := make([]string, 0, len(labels))
	for key, value := range labels {
		parts = append(parts, key+"="+value)
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

func prune[T any](items map[string]cacheEntry[T], now time.Time) {
	for key, entry := range items {
		if !entry.expiresAt.After(now) {
			delete(items, key)
		}
	}
}
