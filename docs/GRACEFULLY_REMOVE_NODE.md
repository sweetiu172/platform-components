# GRACEFULLY REMOVE NODE FROM K8S CLUSTER

## Overview

At the time of writing, there is 2 worker nodes in the cluster. I will remove worker node `worker2` from the cluster to save some resources from my workstation.

After removing the `worker2`, I will increase the memory of `controlplane` and `worker1` by 512MiB each.

## Steps

### Step 1: Find the Pods Running on Worker2

First, list all the pods specifically scheduled on the node you are planning to terminate.

```bash
kubectl get pods --field-selector spec.nodeName=worker2 --all-namespaces -o wide
```

Note the name and namespace of the pod you need to migrate.

### Step 2: Identify the PVC, PV, and hostPath Directory

**2.1:** Find the Pods Running on Node 2
First, list all the pods specifically scheduled on the node you are planning to terminate.

```bash
kubectl get pods --field-selector spec.nodeName=node2 --all-namespaces -o wide
```
Note the name and namespace of the pod you need to migrate.

**2.2** Identify the PVC, PV, and hostPath Directory
Now that you have the pod name, trace it back to the exact folder on node2.

In my case, there are 2 pods running on `worker2` with pvcs attached:

```bash
$ kubectl get pods --field-selector spec.nodeName=worker2 --all-namespaces -o wide
NAMESPACE          NAME                                                       READY   STATUS    RESTARTS       AGE   IP             NODE      NOMINATED NODE   READINESS GATES
...
monitoring         kube-prometheus-stack-grafana-0                            3/3     Running   0              24d   10.0.2.231     worker2   <none>           <none>
...
vault              vault-0                                                    1/1     Running   0              26d   10.0.2.172     worker2   <none>           <none>
 ...
```

1. Find the PVC attached to the pod:

```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.volumes[*].persistentVolumeClaim.claimName}{"\n"}'
```

2. Find the PV bound to that PVC:

```bash
kubectl get pvc <pvc-name> -n <namespace> -o jsonpath='{.spec.volumeName}{"\n"}'
```
3. Get the exact hostPath directory on the node:

```bash
kubectl get pv <pv-name> -o jsonpath='{.spec.hostPath.path}{"\n"}'
```

Write this path down. You will need it for the data transfer.
For example:
```txt
/data/pvc-36cddd47-f4a3-4ff6-bafb-e67baecf5c9f_vault_data-vault-0
/data/pvc-65385b78-0470-4d30-8d19-d0bc46a2a74c_monitoring_storage-kube-prometheus-stack-grafana-0
```

### Step 3: Scale Down the Workload

To prevent data corruption, you must stop the application from writing to the disk before you copy anything.

1. Find what is managing the pod (Deployment, StatefulSet, etc.):

```bash
kubectl get pod <pod-name> -n <namespace> -o custom-columns=OWNER_KIND:.metadata.ownerReferences[0].kind,OWNER_NAME:.metadata.ownerReferences[0].name
```
2. Scale that resource down to zero:

```bash
kubectl scale <OWNER_KIND> <OWNER_NAME> --replicas=0 -n <namespace>
```
Wait a few moments and run kubectl get pods -n <namespace> to verify the pod has fully terminated.

### Step 4: Transfer the Data from Worker2 to Worker1
Now you will move the actual files at the operating system level.

1. SSH into Worker2:

```bash
ssh simon@192.168.1.17
```

2. Check owner of the directory:

```bash
ls -ls /data/
```

3. Use rsync to push the directory to Worker1:

```bash
sudo rsync -avzP /data/pvc-36cddd47-f4a3-4ff6-bafb-e67baecf5c9f_vault_data-vault-0 simon@192.168.1.16:~/
```

4. SSH into Worker 1

```bash
ssh simon@192.168.1.16
```

5. Move the files to the correct location:

```bash
sudo mv ~/pvc-36cddd47-f4a3-4ff6-bafb-e67baecf5c9f_vault_data-vault-0 /data/
```

6. Change the owner of the directory:

```bash
sudo chown -R 100:1000 /data/pvc-36cddd47-f4a3-4ff6-bafb-e67baecf5c9f_vault_data-vault-0
```

Note: This will be depending on step 4.2

### Step 5: Recreate the Storage Objects

Because your old PersistentVolume (PV) is hardcoded to worker2, you need to delete it and create a new one pointing to worker1.

1. Export the Current PV Configuration:

```bash
kubectl get pv <pv-name> -o yaml > vault-pv.yaml
```

2. Edit the YAML File:

```bash
vi vault-pv.yaml
```

You need to make two crucial changes:

- **A. Clean up the metadata:** Delete the following lines under the metadata section so Kubernetes accepts it as a clean, new object:

    - creationTimestamp

    - resourceVersion

    - uid

- **B. Update the Node Affinity:** Scroll down to the nodeAffinity section and change worker2 to your new node's name. It should look like this:

    ```yaml
    nodeAffinity:
        required:
        nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
            operator: In
            values:
            - <YOUR-NEW-NODE-NAME> # <-- Update this line
    ...
    claimRef:
        apiVersion: v1
        kind: PersistentVolumeClaim
        name: data-vault-0
        namespace: vault
        resourceVersion: "123456" # <-- DELETE THIS LINE
        uid: a1b2c3d4-xxxx-xxxx  # <-- DELETE THIS LINE
    ```

3. Delete the old PV:
(Don't worry, deleting a hostPath PV object does not delete the files on the OS).

```bash
kubectl delete pv <pv-name>
kubectl patch pv <pv-name> -p '{"metadata":{"finalizers":null}}'
kubectl patch pv <pv-name> -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```


4. Create a new PV mapping to Worker 1:
```bash
kubectl apply -f vault-pv.yaml
```

5. Delete the Lost PVC
```bash
kubectl delete pvc data-vault-0 -n vault
```

6. Scale the StatefulSet Back Up
```bash
kubectl scale <OWNER_KIND> <OWNER_NAME> --replicas=1 -n <namespace>
```

7. Verify the pod is running on the new node:
```bash
kubectl get pods -n <namespace> -o wide
```

### Step 6: Remove the Node from the Cluster

1. Cordon the Node:
```bash
kubectl cordon worker2
```

2. Drain the Node:
```bash
kubectl drain worker2 --ignore-daemonsets --delete-emptydir-data
```

3. Remove the Node from the Cluster:
```bash
kubectl delete node worker2
```

4. Verify the Node is Removed:
```bash
kubectl get nodes
```

5. Delete the old node from Proxmox

### Step 7 (Optional): Increase memory of controlplane and worker1

1. Shutdown the node
2. Increase memory
3. Boot the node
4. Special case for worker node:

    **4.1**. Check CoreDNS Status
    When you shut down worker1, you might have accidentally taken down the node that was running your CoreDNS pods. If CoreDNS is offline or stuck in a Terminating state, cluster-wide DNS resolution will fail for all pods.

    Run this command to check where your DNS pods are and if they are healthy:

    ```bash
    kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
    ```
    
    If they are **Pending**: They were likely evicted from worker1 but don't have enough resources (or node affinities are preventing them) from scheduling on your other nodes.

    If they are **Terminating**: They are stuck trying to gracefully shut down on worker1 (which is offline). You can force delete them so they reschedule elsewhere:

    ```bash
    kubectl delete pod <coredns-pod-name> -n kube-system --force --grace-period=0
    ```
    
    **4.2**. Inspect the CNI (Cilium)
    If CoreDNS is running fine on another node, the issue is your pod-to-pod networking. Shutting down a node abruptly can sometimes cause the Container Network Interface (CNI) to drop routes or get out of sync.

    Check the status of your Cilium agents across the cluster to ensure the overlay network is fully operational and hasn't lost quorum or routing capabilities due to the missing node:

    ```bash
    kubectl get pods -n kube-system -l k8s-app=cilium -o wide
    ```
    
    
    If the Cilium pod on the node where cloudflared is running shows restarts or errors, you might need to restart it to re-establish the tunnel to the rest of the cluster:

    ```bash
    kubectl rollout restart ds/cilium -n kube-system
    ```

    **4.3**. Restart argo-cd-dex-server
    ```bash
    kubectl rollout restart deployment/argo-cd-dex-server -n argocd
    ```