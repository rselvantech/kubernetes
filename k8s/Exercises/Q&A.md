
## 1.How to create Kubernetes resources from 100s of YAML files all at once
<details>
<summary>Answer:</summary> 
kubectl apply command takes directory as an argument. This allows us to create as many resources as we like all at once.

```
kubectl apply -f ./demo/ 
```
</details>

***

## 1.How to get Kubernetes resource configurations in JSON YAML or wide format
<details>
<summary>Answer:</summary> 

```
alias k=kubectl
k get po nginx -o json
k get po nginx -o yaml
k get po nginx -o wide
k get svc kubernetes -o json
```
</details>