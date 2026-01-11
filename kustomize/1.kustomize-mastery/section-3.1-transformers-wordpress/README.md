## Lab Objective
Practice the following ways of defining and using **Transformers** in Kustomize:

1. **External Configuration File** (example-3)
2. **Internal/Inline Configuration** (example-4)
3. **Convenience Fields** (example-1 & example-2 , exmaple-5)

---

## Directory  Structure
```
.
├── section-3-kustomization-file-wordpress
│   ├── README.md
│   ├── base
│   │   ├── deployment.yaml
│   │   ├── kustomization.yaml
│   │   └── service.yaml
│   ├── example-1-name-prefix
│   │   ├── kustomization.yaml
│   │   └── result.yaml
│   ├── example-2-name-prefix-suffix
│   │   ├── kustomization.yaml
│   │   └── result.yaml
│   ├── example-3-transformer-external
│   │   ├── kustomization.yaml
│   │   ├── result.yaml
│   │   └── transformers
│   │       └── nameprefix.yaml
│   ├── example-4-transformer-internal
│   │   ├── kustomization.yaml
│   │   └── results.yaml
│   └── example-5-multi-environment
│       ├── dev
│       │   ├── kustomization.yaml
│       │   └── results.yaml
│       ├── production
│       │   ├── kustomization.yaml
│       │   └── results.yaml
│       └── staging
│           ├── kustomization.yaml
│           └── results.yaml
```
---

## Example-1: Name Prefix Transformer

### Overview
This example demonstrates the use of **convenience fields** `namePrefix` & `commonLabels` to transform Kubernetes resources.

### Fields Used

#### `namePrefix`
- **Type**: Convenience field
- **Purpose**: Adds the string to the beginning of all resource names in your kustomization
- **Use case**: Version your resources, avoid naming conflicts, enable side-by-side deployments

#### `commonLabels`
- **Type**: Convenience field
- **Purpose**: Adds the specified labels to all resources and label selectors in your kustomization
- **⚠️ Warning**: This field is deprecated, need to  use `labels` instead 

### Expected Output

✅ `v1-` prefix added to all resource names  
✅ Common labels applied to all resources  
✅ Original base files remain unchanged 

---

## Example-2: Name Prefix + Suffix Transformer

### Overview
Another example demonstrates the use of **convenience fields** `namePrefix` & `nameSuffix`to transform Kubernetes resources.

### Fields Used

#### `namePrefix`
- **Type**: Convenience field
- **Purpose**: Adds the string to the beginning of all resource names in your kustomization
- **Use case**: Version your resources, avoid naming conflicts, enable side-by-side deployments

#### `nameSuffix`
- **Type**: Convenience field
- **Purpose**: Adds the string to the end of all resource names in your kustomization
- **Use case**: Version your resources, avoid naming conflicts, enable side-by-side deployments


### Expected Output

✅ `dev-` prefix and `-v2` suffix added to all resource names  

---

## Example-3: Using External Transformer File

### Overview
This example demonstrates the use of **external transformer** to transform Kubernetes resources.

**Note:**: here the tranformer configuration is done in a spearate configuration file `transformers/nameprefix.yaml`

### Fields Used

#### `PrefixSuffixTransformer`
- **Type**: Transformer
- **Purpose**: Convenience fields (namePrefix/nameSuffix) and PrefixSuffixTransformer configuration both do the same thing, but the transformer gives you fine-grained control over which resources/fields gets transformed
- **Example**: This exmaple config adds prefix `api-` only to name of Deployment & Service resources only
    ```
    # prefix-suffix-transformer.yaml
    apiVersion: builtin
    kind: PrefixSuffixTransformer
    metadata:
    name: selective-transformer
    prefix: api-
    fieldSpecs:
    - path: metadata/name
        kind: Deployment
    - path: metadata/name
        kind: Service
    ```

### Expected Output

✅ `prod-` prefix added to the following fileds of all resources
  - metadata/name
  - metadata/labels/app (`app` is a label , prefix applied only to this label)
  - spec/selector/matchLabels/app
  - spec/template/metadata/labels/app

---

## Example-4: Using Internal/Inline Transformer

### Overview
This is  example-3 using  **internal/inline transformer** 

**Note:**: here the tranformer configuration is done inside the same `kustomization.yaml` configuration file , no additional configuration file needed.

---
## Example-5: Using Internal/Inline Transformer

### Overview
This example demonstrates the use of **convenience field** `replicas` to transform Kubernetes resources.

### Fields Used

#### `replicas`
- **Type**: Convenience Field
- **Purpose**: allows you to override the number of replicas for specific workloads.
- **Usecase**: Different replica counts for dev/staging/prod
- **Example**:
```
replicas:
  - name: wordpress  # 1. FIND the resource named "wordpress"
    count: 1         # 2. CHANGE its replicas to 1
```


### Expected Output

✅ Find reource named `wordpress` and change its replica count
