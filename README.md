# DevOps Candidate Assignment - Microservice with Azure Key Vault Integration

## 📋 Overview

This project demonstrates a complete DevOps pipeline for deploying a Node.js microservice on Kubernetes (Minikube) with **dynamic secret management** using Azure Key Vault. The application automatically detects and reflects secret changes from Azure Key Vault **without requiring pod restarts**.

### Key Features

- ✅ Containerized Node.js REST API
- ✅ Kubernetes deployment using Helm charts
- ✅ Dynamic secret updates from Azure Key Vault (no pod restart required)
- ✅ File-system watching for real-time secret rotation
- ✅ GitOps deployment with ArgoCD
- ✅ CI/CD pipeline with GitHub Actions
- ✅ Automated testing and security scanning

---

## 🏗️ Architecture

```
┌─────────────────────┐
│  Azure Key Vault    │
│   (Secret Store)    │
└──────────┬──────────┘
           │
           │ Syncs every 30s
           ▼
┌─────────────────────────────┐
│ Secrets Store CSI Driver    │
│ (Kubernetes Component)      │
└──────────┬──────────────────┘
           │
           │ Mounts as file
           ▼
┌─────────────────────────────┐
│  /mnt/secrets-store/        │
│      my-secret              │  ◄── Symlinked file
└──────────┬──────────────────┘
           │
           │ fs.watch()
           ▼
┌─────────────────────────────┐
│   Node.js Application       │
│   - Watches file changes    │
│   - Auto-reloads on change  │
│   - No restart needed       │
└─────────────────────────────┘
```

### How Dynamic Secret Updates Work

This is the **core feature** of the assignment. Here's how it works:

1. **Azure Key Vault** stores the secret (`my-secret`)
2. **Secrets Store CSI Driver** polls Azure Key Vault every 30 seconds for changes
3. **CSI Driver** mounts secrets as **files** (not environment variables) at `/mnt/secrets-store/`
4. When a secret is updated in Azure Key Vault:
   - CSI Driver detects the change
   - Updates the mounted file using atomic symlink swap (`..data` → new version)
   - Node.js `fs.watch()` detects the file change event
   - Application reloads the secret from disk
   - **No pod restart required!**

#### Why Files Instead of Environment Variables?

**Environment variables cannot be updated at runtime** in Kubernetes. Once a pod starts, its environment variables are immutable. To achieve dynamic secret updates without pod restarts, we use:

- **CSI Driver with file mounting** - secrets are mounted as files
- **File system watching** - Node.js watches the file for changes
- **Automatic reload** - application reads the latest value on each request or file change

---

## 📂 Project Structure

```
devOps-candidate-assignment/
├── app/
│   ├── server.js              # Node.js application with hot reload
│   ├── server.test.js         # Jest tests
│   ├── package.json           # Dependencies
│   ├── Dockerfile             # Container image
│   └── public/
│       └── index.html         # Simple UI
├── helm/
│   ├── argocd/
│   │   └── values.yaml        # ArgoCD Helm values (includes ingress config)
│   └── my-node-app-chart/
│       ├── Chart.yaml         # Helm chart metadata
│       ├── values.yaml        # Configuration values
│       └── templates/
│           ├── deployment.yaml          # Kubernetes Deployment
│           ├── service.yaml             # Kubernetes Service
│           ├── ingress.yaml             # Ingress for external access
│           └── secretproviderclass.yaml # Azure Key Vault config
├── argocd/
│   ├── applications-project.yaml # ArgoCD project
│   ├── nodejs-app.yaml        # ArgoCD Application manifest
│   ├── csi-driver.yaml        # CSI Driver ArgoCD app
│   └── csi-azure-provider.yaml # Azure Provider ArgoCD app
├── k8s/
│   ├── manifests/
│   │   ├── argocd/
│   │   │   └── argocd-tls.yaml        # TLS secret for ArgoCD ingress
│   │   ├── csi-azure-provider/
│   │   │   └── provider-azure-installer.yaml
│   │   └── my-node-app/
│   │       ├── dockerconfigjson.yaml  # Registry credentials
│   │       └── my-node-app-tls.yaml   # TLS secret for app ingress
│   └── tls/
│       ├── wildcard-tls.crt   # TLS certificate
│       ├── wildcard-tls.key   # TLS private key
│       └── wildcard.cnf       # OpenSSL config
└── .github/
    └── workflows/
        └── ci.yaml            # GitHub Actions CI/CD pipeline
```

---

## 🚀 Prerequisites

### Required Tools

- **Minikube** or **Docker Desktop** with Kubernetes enabled
- **kubectl** (Kubernetes CLI)
- **Helm** 3.x
- **Azure CLI** (`az`)
- **ArgoCD CLI** (optional, for GitOps)
- **Git**

### Azure Requirements

- Azure subscription
- Service Principal with access to Azure Key Vault

---

## 🔧 Setup Instructions

### Step 1: Azure Key Vault Setup

#### 1.1 Login to Azure and Set Subscription

```bash
# Login to Azure
az login

# List available subscriptions
az account list --output table

# Set your subscription
az account set --subscription "YOUR_SUBSCRIPTION_ID"

# Verify current subscription
az account show --output table
```

#### 1.2 Create Azure Key Vault

```bash
# Set variables
RESOURCE_GROUP="my-rg"
KEYVAULT_NAME="my-keysvault"  # Must be globally unique
LOCATION="germanywestcentral"

# Create resource group
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION

# Create Key Vault with RBAC enabled
az keyvault create \
  --name $KEYVAULT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --enable-rbac-authorization true
```

#### 1.3 Create a Secret

```bash
# Create initial secret
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name my-secret \
  --value "initial-secret-value-v1"
```

**Note**: You may need to assign yourself the "Key Vault Secrets Officer" role to create secrets:

```bash
# Get your user object ID
USER_ID=$(az ad signed-in-user show --query id --output tsv)

# Assign Key Vault Secrets Officer role to yourself
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee $USER_ID \
  --scope $(az keyvault show --name $KEYVAULT_NAME --query id -o tsv)
```

#### 1.4 Create Service Principal

```bash
# Create Service Principal
SP=$(az ad sp create-for-rbac \
  --name "my-node-app-sp" \
  --skip-assignment \
  --output json)

# Extract values
CLIENT_ID=$(echo $SP | jq -r .appId)
CLIENT_SECRET=$(echo $SP | jq -r .password)
TENANT_ID=$(echo $SP | jq -r .tenant)

# Save these values - you'll need them later
echo "Client ID: $CLIENT_ID"
echo "Client Secret: $CLIENT_SECRET"
echo "Tenant ID: $TENANT_ID"
```

#### 1.5 Grant Key Vault Access (Using RBAC)

```bash
# Get the Key Vault resource ID
KEYVAULT_ID=$(az keyvault show \
  --name $KEYVAULT_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id \
  --output tsv)

# Assign "Key Vault Secrets User" role to Service Principal
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee $CLIENT_ID \
  --scope $KEYVAULT_ID

# Verify the role assignment
az role assignment list \
  --assignee $CLIENT_ID \
  --scope $KEYVAULT_ID \
  --output table
```

**Why RBAC instead of Access Policies?**
- Azure Key Vault RBAC is the recommended approach (access policies are legacy)
- More granular and consistent with Azure's unified RBAC model
- Easier to manage at scale with Azure AD groups
- Better integration with Azure governance tools

---

### Step 2: Kubernetes Setup

#### 2.1 Start Minikube (or enable Docker Desktop Kubernetes)

```bash
# Option A: Using Minikube
minikube start --driver=docker --cpus=4 --memory=8192

# Option B: Using Docker Desktop
# Enable Kubernetes in Docker Desktop settings
```

#### 2.2 Create Kubernetes Secret for Azure Credentials

```bash
# Create namespace
kubectl create namespace apps

# Create secret with Azure Service Principal credentials
kubectl create secret generic azure-kv-creds \
  --from-literal=clientid="$CLIENT_ID" \
  --from-literal=clientsecret="$CLIENT_SECRET" \
  --namespace apps

# Label the secret for CSI driver
kubectl label secret azure-kv-creds \
  secrets-store.csi.k8s.io/used=true \
  --namespace apps
```

---

### Step 3: Install Secrets Store CSI Driver

#### 3.1 Install CSI Driver

```bash
# Add Helm repository
helm repo add secrets-store-csi-driver \
  https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts

# Update repos
helm repo update

# Install CSI Driver with secret rotation enabled
helm install csi-secrets-store \
  secrets-store-csi-driver/secrets-store-csi-driver \
  --namespace kube-system \
  --set syncSecret.enabled=true \
  --set enableSecretRotation=true \
  --set rotationPollInterval=30s
```

**Key Parameters Explained:**
- `enableSecretRotation=true` - Enables automatic secret rotation
- `rotationPollInterval=30s` - Checks Azure Key Vault every 30 seconds for changes
- `syncSecret.enabled=true` - Allows syncing to Kubernetes secrets (optional)

#### 3.2 Install Azure Provider

```bash
# Install Azure Key Vault Provider using manifest
kubectl apply -f k8s/manifests/csi-azure-provider/provider-azure-installer.yaml

# Alternative: Install directly from GitHub (if manifests not available locally)
kubectl apply -f https://raw.githubusercontent.com/Azure/secrets-store-csi-driver-provider-azure/master/deployment/provider-azure-installer.yaml
```

#### 3.3 Verify Installation

```bash
# Check CSI Driver pods
kubectl get pods -n kube-system | grep csi

# Expected output:
# csi-azure-provider-xxxxx           1/1  Running
# csi-secrets-store-xxxxx            3/3  Running
```

---

### Step 4: Deploy the Application

#### 4.1 Update Helm Values

Edit [`helm/my-node-app-chart/values.yaml`](helm/my-node-app-chart/values.yaml):

```yaml
secretsStore:
  enabled: true
  mountPath: /mnt/secrets-store
  secretProviderClass:
    name: azure-keyvault
    provider: azure
    azure:
      keyvaultName: my-keysvault        # ← Update with your Key Vault name
      tenantId: "YOUR-TENANT-ID"        # ← Update with your Tenant ID
      clientId: "YOUR-CLIENT-ID"        # ← Update with your Client ID
      clientSecretRef:
        name: azure-kv-creds
        key: clientSecret
    objects:
      - objectName: my-secret
        objectType: secret
```

#### 4.2 Install Application with Helm

```bash
# Install the application
helm install my-node-app \
  ./helm/my-node-app-chart \
  --namespace apps \
  --create-namespace

# Verify deployment
kubectl get pods -n apps
kubectl get svc -n apps
```

#### 4.3 Access the Application

**Option 1: Using Port-Forward (Works with Minikube and Docker Desktop)**

```bash
# Port-forward to access locally
kubectl port-forward -n apps svc/my-node-app 3000:3000

# Test endpoints
curl http://localhost:3000/
curl http://localhost:3000/health
curl http://localhost:3000/config
curl http://localhost:3000/secret-info
```

**Option 2: Using Ingress (Docker Desktop Only)**

If using **Docker Desktop**, you can access the app via Ingress with a custom domain.

First, add the hostname to `/etc/hosts`:

```bash
# Add entry to /etc/hosts (requires sudo)
echo "127.0.0.1 node-app.example.com" | sudo tee -a /etc/hosts

# Verify the entry was added
grep "node-app.example.com" /etc/hosts
```

Then access via the domain:

```bash
# Access via ingress (HTTPS)
curl -Ikv https://node-app.example.com/config

# Or in browser
open https://node-app.example.com
```

**Note for Minikube Users:**

If using Minikube, you need to get the Minikube IP first:

```bash
# Get Minikube IP
MINIKUBE_IP=$(minikube ip)

# Add to /etc/hosts
echo "$MINIKUBE_IP node-app.example.com" | sudo tee -a /etc/hosts

# Enable ingress addon
minikube addons enable ingress
```

**Important:** The ingress method requires:
- Ingress controller installed (nginx-ingress)
- TLS certificates configured (already in `k8s/tls/`)
- Hostname added to `/etc/hosts`
- For production, use real DNS records instead of `/etc/hosts`

---

### Step 5: Test Dynamic Secret Updates

This is the **key demonstration** of the assignment requirements.

#### 5.1 Check Current Secret Value

```bash
# Get current secret from the application
curl http://localhost:3000/config

# Expected output:
{
  "mySecret": "initial-secret-value-v1",
  "timestamp": "2024-01-20T12:00:00.000Z",
  "lastUpdated": "2024-01-20T12:00:00.000Z",
  "fileWatcherActive": true
}
```

#### 5.2 Update Secret in Azure Key Vault

```bash
# Rotate the secret in Azure Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name my-secret \
  --value "rotated-secret-value-v2"
```

#### 5.3 Wait for Automatic Update (30-60 seconds)

The CSI Driver polls every 30 seconds. Watch the application logs:

```bash
# Watch pod logs to see the secret rotation
kubectl logs -n apps -l app.kubernetes.io/name=my-node-app -f

# You should see logs like:
# [2024-01-20T12:01:00.000Z] File change detected: rename on ..data
# [2024-01-20T12:01:00.100Z] 🔄 SECRET ROTATED!
#   Old: initial-secret-value-v1
#   New: rotated-secret-value-v2
```

#### 5.4 Verify New Secret Value

```bash
# Check the updated secret (NO POD RESTART NEEDED!)
curl -Ikv https://node-app.example.com/config

# Expected output:
{
  "mySecret": "rotated-secret-value-v2",  ← Updated!
  "timestamp": "2024-01-20T12:01:00.000Z",
  "lastUpdated": "2024-01-20T12:01:00.000Z",
  "fileWatcherActive": true
}

# Verify no pod restarts occurred
kubectl get pods -n apps

# The AGE should show the pod has NOT been restarted
```

---

## 🔍 How the Secret Update Mechanism Works

### Technical Deep Dive

The application achieves **zero-downtime secret rotation** through the following mechanism:

#### 1. **CSI Driver Secret Mounting**

The [`deployment.yaml`](helm/my-node-app-chart/templates/deployment.yaml) mounts secrets as a CSI volume:

```yaml
volumes:
  - name: secrets-store
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: azure-keyvault
      nodePublishSecretRef:
        name: azure-kv-creds

volumeMounts:
  - name: secrets-store
    mountPath: /mnt/secrets-store
    readOnly: true
```

#### 2. **SecretProviderClass Configuration**

The [`secretproviderclass.yaml`](helm/my-node-app-chart/templates/secretproviderclass.yaml) defines which secrets to fetch:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: azure-keyvault
spec:
  provider: azure
  parameters:
    keyvaultName: my-keysvault
    tenantId: "YOUR-TENANT-ID"
    objects: |
      array:
        - objectName: my-secret
          objectType: secret
```

#### 3. **File System Structure**

When the CSI driver mounts secrets, it creates the following structure:

```
/mnt/secrets-store/
├── my-secret          → symlink to ..data/my-secret
└── ..data/            → symlink to ..2024_01_20_12_00_00.123456789/
    └── my-secret      → actual file content
```

When a secret updates:
1. CSI driver creates new directory: `..2024_01_20_12_01_00.987654321/`
2. Updates `..data` symlink to point to new directory (atomic operation)
3. `fs.watch()` detects the symlink change
4. Application reloads the secret

#### 4. **Node.js File Watching**

The [`server.js`](app/server.js) implements file watching:

```javascript
// Watch the secrets directory for changes
fs.watch('/mnt/secrets-store', { recursive: false }, (eventType, filename) => {
  if (filename === 'my-secret' || filename === '..data') {
    console.log(`File change detected: ${eventType} on ${filename}`);

    // Small delay to ensure file is fully written
    setTimeout(() => {
      const oldValue = secretCache.value;
      const newValue = readSecretFromDisk();

      if (oldValue !== newValue) {
        console.log(`🔄 SECRET ROTATED!`);
        console.log(`  Old: ${oldValue}`);
        console.log(`  New: ${newValue}`);
      }
    }, 100);
  }
});
```

**Key Implementation Details:**
- Watches `/mnt/secrets-store` directory
- Listens for changes to `my-secret` file or `..data` symlink
- Adds 100ms delay to ensure atomic write completion
- Reloads secret from disk when change detected
- Logs old and new values for debugging

#### 5. **Always-Fresh Secret Reads**

```javascript
function getSecret() {
  // Always read from disk to ensure latest value
  return readSecretFromDisk();
}

app.get("/config", (req, res) => {
  res.json({
    mySecret: getSecret(),  // ← Always reads latest from disk
    timestamp: new Date().toISOString()
  });
});
```

---

## 🎯 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service information and version |
| `/health` | GET | Health check endpoint (returns "OK") |
| `/config` | GET | **Returns current secret value** (auto-updated) |
| `/secret-info` | GET | Detailed secret metadata (path, symlink info, file timestamps) |
| `/trigger-reload` | GET | Manually trigger secret reload from disk |

### Example Responses

#### GET /config
```json
{
  "mySecret": "rotated-secret-value-v2",
  "timestamp": "2024-01-20T12:01:30.123Z",
  "lastUpdated": "2024-01-20T12:01:00.456Z",
  "fileWatcherActive": true
}
```

#### GET /secret-info
```json
{
  "value": "rotated-secret-value-v2",
  "path": "/mnt/secrets-store/my-secret",
  "realPath": "/mnt/secrets-store/..2024_01_20_12_01_00.987654321/my-secret",
  "isSymlink": true,
  "fileModified": "2024-01-20T12:01:00.000Z",
  "cacheLastUpdated": "2024-01-20T12:01:00.456Z",
  "watcherActive": true
}
```

---

## 🔄 GitOps with ArgoCD (Bonus)

### Install ArgoCD with Helm

ArgoCD is installed using Helm with custom values that include ingress configuration.

```bash
# Add ArgoCD Helm repository
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

# Create namespace
kubectl create namespace argocd

# Create TLS secret for ArgoCD ingress (required before installing)
kubectl apply -f k8s/manifests/argocd/argocd-tls.yaml

# Install ArgoCD using Helm with custom values
helm upgrade -i argocd argo/argo-cd \
  --namespace argocd \
  --values helm/argocd/values.yaml

# Wait for ArgoCD to be ready
kubectl wait --for=condition=available deployment/argocd-server \
  -n argocd --timeout=300s
```

**Important:** The Helm values file ([`helm/argocd/values.yaml`](helm/argocd/values.yaml)) configures ingress for ArgoCD. The ingress expects a TLS secret named `argocd-tls` which must be created before installing ArgoCD:

```bash
# The TLS secret is defined in k8s/manifests/argocd/argocd-tls.yaml
# and should be applied with kubectl before running helm install
```

**Note for Local Development:** If you want to access ArgoCD via ingress (instead of port-forward), you need to add the hostname to `/etc/hosts`:

```bash
# For Docker Desktop
echo "127.0.0.1 argocd.example.com" | sudo tee -a /etc/hosts

# For Minikube
echo "$(minikube ip) argocd.example.com" | sudo tee -a /etc/hosts

# Verify the entry
grep "argocd.example.com" /etc/hosts
```

This allows you to access ArgoCD at `https://argocd.example.com` (the hostname configured in the Helm values).

### Access ArgoCD UI

**Option 1: Via Ingress (if configured)**

Add ArgoCD hostname to `/etc/hosts`:

```bash
# Docker Desktop
echo "127.0.0.1 argocd.example.com" | sudo tee -a /etc/hosts

# Minikube
echo "$(minikube ip) argocd.example.com" | sudo tee -a /etc/hosts

# Access via browser
open https://argocd.example.com
```

**Option 2: Via Port-Forward**

```bash
# Port-forward to access ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Open in browser
open https://localhost:8080
```

**Get Admin Password:**

```bash
# Get initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# Login credentials:
# Username: admin
# Password: <from above command>
```

### Deploy Applications with ArgoCD

```bash
# Create ArgoCD project
kubectl apply -f argocd/applications-project.yaml

# Deploy CSI Driver via ArgoCD
kubectl apply -f argocd/csi-driver.yaml
kubectl apply -f argocd/csi-azure-provider.yaml

# Deploy Node.js application via ArgoCD
kubectl apply -f argocd/nodejs-app.yaml

# Verify ArgoCD applications
kubectl get applications -n argocd
```
*Another option is to be used app of apps pattern*

### How ArgoCD Enables GitOps

The [`nodejs-app.yaml`](argocd/nodejs-app.yaml) configures ArgoCD to:

```yaml
syncPolicy:
  automated:
    prune: true      # Delete resources removed from Git
    selfHeal: true   # Auto-correct manual changes
```

**Benefits:**
- Any change to Helm chart in Git → Automatic deployment
- Manual kubectl changes → Automatically reverted
- Single source of truth (Git repository)

---

## 🚀 CI/CD Pipeline with GitHub Actions (Bonus)

This project includes a fully automated CI/CD pipeline using GitHub Actions.

### Pipeline Overview

The [`.github/workflows/ci.yaml`](.github/workflows/ci.yaml) pipeline automatically:

1. **Build Phase**
   - Sets up Node.js 20
   - Installs dependencies (`npm ci`)
   - Runs Jest tests (`npm test`)

2. **Security Scanning**
   - Builds Docker image locally
   - Scans with Trivy for vulnerabilities
   - **Fails the pipeline** if CRITICAL or HIGH vulnerabilities are found
   - Only proceeds to publish if scan passes

3. **Publish Phase**
   - Authenticates with GitHub Container Registry (ghcr.io)
   - Pushes Docker image with two tags:
     - `ghcr.io/YOUR_USERNAME/node-app:COMMIT_SHA`
     - `ghcr.io/YOUR_USERNAME/node-app:latest`

### How to Use the Automation

#### Automatic Deployment on Every Push

The pipeline triggers automatically on every push to `main` branch:

```bash
# Make changes to your code
vim app/server.js

# Stage and commit
git add app/server.js
git commit -m "Update application logic"

# Push to trigger the pipeline
git push origin main
```

Once pushed:
1. GitHub Actions automatically starts
2. Runs tests
3. Builds Docker image
4. Scans for vulnerabilities
5. Publishes to ghcr.io (if all checks pass)

#### Manual Trigger

You can also trigger the pipeline manually:

1. Go to: `https://github.com/githubadministrator01/devOps-candidate-assignment/actions`
2. Click on "Build, test and scan docker images" workflow
3. Click "Run workflow" button
4. Select branch and click "Run workflow"

### Pipeline Configuration

The pipeline is configured in [`.github/workflows/ci.yaml`](.github/workflows/ci.yaml):

```yaml
on:
  push:
    branches: [ "main" ]
  workflow_dispatch:  # Enables manual trigger
```

**Key Features:**
- ✅ Runs on every push to main
- ✅ Can be triggered manually via GitHub UI
- ✅ Caches dependencies for faster builds
- ✅ Security scanning before publishing
- ✅ Automatic image tagging with commit SHA
- ✅ Publishes to GitHub Container Registry (ghcr.io)

### Integration with ArgoCD

Once the image is published to ghcr.io, ArgoCD can automatically deploy it:

1. Update `helm/my-node-app-chart/values.yaml` with new image tag
2. Commit and push changes
3. ArgoCD detects the change and syncs automatically
4. New version deployed with zero downtime

**Complete GitOps Flow:**
```
Code Change → Git Push → GitHub Actions → Build & Test → Publish Image
                                                              ↓
                                                     ghcr.io Registry
                                                              ↓
                                        ArgoCD Syncs → Deploys to K8s
```

---

## 🧪 Testing

### Run Tests Locally

```bash
cd app

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm test -- --coverage
```

### Test Coverage

The [`server.test.js`](app/server.test.js) tests all endpoints:

- ✅ `GET /` - Service info
- ✅ `GET /health` - Health check
- ✅ `GET /config` - Secret retrieval
- ✅ `GET /secret-info` - Secret metadata
- ✅ `GET /trigger-reload` - Manual reload

---

## 🐛 Troubleshooting

### Secret Not Updating

```bash
# 1. Check CSI driver is running
kubectl get pods -n kube-system | grep csi

# 2. Check CSI driver logs
kubectl logs -n kube-system -l app=secrets-store-csi-driver

# 3. Check pod has volume mounted
kubectl describe pod -n apps <pod-name> | grep -A 5 "Mounts:"

# 4. Check secret file exists in pod
kubectl exec -n apps <pod-name> -- ls -la /mnt/secrets-store/

# 5. Check SecretProviderClass
kubectl get secretproviderclass -n apps
kubectl describe secretproviderclass azure-keyvault -n apps
```

### Application Not Starting

```bash
# Check pod status
kubectl get pods -n apps

# Check pod events
kubectl describe pod -n apps <pod-name>

# Check application logs
kubectl logs -n apps <pod-name>

# Check service principal permissions (RBAC)
az keyvault show --name $KEYVAULT_NAME

# Check role assignments
az role assignment list \
  --assignee $CLIENT_ID \
  --scope $(az keyvault show --name $KEYVAULT_NAME --query id -o tsv) \
  --output table
```

### File Watcher Not Active

```bash
# Check if directory exists in pod
kubectl exec -n apps <pod-name> -- ls -la /mnt/secrets-store/

# Check file permissions
kubectl exec -n apps <pod-name> -- stat /mnt/secrets-store/my-secret

# Check application logs for watcher status
kubectl logs -n apps <pod-name> | grep "watcher"
```

---

## 🔐 Security Best Practices

### Implemented in This Project

1. **Least Privilege Access**
   - Service Principal has only `get` and `list` permissions on secrets
   - Read-only volume mounts

2. **Secret Scanning**
   - Trivy scans for vulnerabilities before pushing images
   - Fails CI/CD on CRITICAL/HIGH vulnerabilities

3. **No Secrets in Git**
   - Azure credentials stored as Kubernetes secrets
   - No hardcoded secrets in code or manifests

4. **Automated Rotation**
   - Secrets can be rotated without application downtime
   - No manual intervention required

### Additional Recommendations

- Rotate Service Principal credentials regularly
- Enable Azure Key Vault logging
- Use private container registries

---

## 📚 Technologies Used

| Technology | Purpose |
|------------|---------|
| **Node.js** | Application runtime |
| **Express.js** | Web framework |
| **Docker** | Containerization |
| **Kubernetes** | Container orchestration |
| **Helm** | Kubernetes package manager |
| **Azure Key Vault** | Secret management |
| **Secrets Store CSI Driver** | Secret mounting |
| **ArgoCD** | GitOps continuous delivery |
| **GitHub Actions** | CI/CD pipeline |
| **Trivy** | Security vulnerability scanning |
| **Jest** | Testing framework |
