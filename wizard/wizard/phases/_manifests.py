"""Pure-string Kubernetes manifest renderers used by phase 6.

No I/O lives here — every function takes plain values and returns a YAML
string. Keeping renderers pure makes phase 6 trivially testable: tests
assert on the returned strings and never hit the filesystem.

The umbrella plan (`Agents/TODO/Active/project-review-and-plan.md` §4.1)
lists a standalone `pvc.yaml` in the file set; M3 supersedes that with
`volumeClaimTemplates` inline in the StatefulSet, the canonical pattern
for stable per-pod PVC binding under Q-ARCH-1.
"""

from __future__ import annotations

NAMESPACE = "eloup"
WEB_LABEL = "eloup-web"
WEB_PORT = 3000
STORAGE_CLASS = "linode-block-storage-retain"
STORAGE_SIZE = "5Gi"
INGRESS_CLASS = "nginx"
CLUSTER_ISSUER = "letsencrypt-prod"
TLS_SECRET = "eloup-tls"
CONFIGMAP_NAME = "eloup-web-config"
SECRET_NAME = "eloup-web-secret"
DATA_VOLUME_NAME = "data"
DATA_MOUNT_PATH = "/data"
DATABASE_PATH = "/data/eloup.sqlite"
WEB_SERVICE_NAME = "eloup-web"

WIZARD_MANAGED_BY = "eloup-wizard"

APPLICATION_NAME = "eloup"
ARGOCD_NAMESPACE = "argocd"
ARGOCD_PROJECT = "default"
ARGOCD_DESTINATION_SERVER = "https://kubernetes.default.svc"
ARGOCD_SOURCE_PATH = "K8s"

REPO_SECRET_NAME = "eloup-repo"

APP_RUNTIME_SECRET_KEYS: frozenset[str] = frozenset({"discord_client_secret", "app_session_secret"})


def render_namespace() -> str:
    return f"""\
apiVersion: v1
kind: Namespace
metadata:
  name: {NAMESPACE}
  labels:
    app: eloup
    app.kubernetes.io/managed-by: {WIZARD_MANAGED_BY}
"""


def render_configmap(*, discord_client_id: str, app_domain: str) -> str:
    return f"""\
apiVersion: v1
kind: ConfigMap
metadata:
  name: {CONFIGMAP_NAME}
  namespace: {NAMESPACE}
  labels:
    app: {WEB_LABEL}
data:
  DISCORD_CLIENT_ID: "{discord_client_id}"
  APP_DOMAIN: "https://{app_domain}"
  DATABASE_PATH: "{DATABASE_PATH}"
"""


def render_service() -> str:
    return f"""\
apiVersion: v1
kind: Service
metadata:
  name: {WEB_SERVICE_NAME}
  namespace: {NAMESPACE}
  labels:
    app: {WEB_LABEL}
spec:
  type: ClusterIP
  selector:
    app: {WEB_LABEL}
  ports:
    - name: http
      port: {WEB_PORT}
      targetPort: {WEB_PORT}
      protocol: TCP
"""


def render_statefulset(*, image: str, use_http_probe: bool) -> str:
    if use_http_probe:
        liveness = f"""\
          livenessProbe:
            httpGet:
              path: /api/health
              port: {WEB_PORT}
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: {WEB_PORT}
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3"""
    else:
        liveness = f"""\
          livenessProbe:
            tcpSocket:
              port: {WEB_PORT}
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            tcpSocket:
              port: {WEB_PORT}
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3"""

    return f"""\
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {WEB_LABEL}
  namespace: {NAMESPACE}
  labels:
    app: {WEB_LABEL}
spec:
  serviceName: {WEB_SERVICE_NAME}
  replicas: 1
  selector:
    matchLabels:
      app: {WEB_LABEL}
  template:
    metadata:
      labels:
        app: {WEB_LABEL}
    spec:
      securityContext:
        fsGroup: 1000
      containers:
        - name: {WEB_LABEL}
          image: {image}
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: {WEB_PORT}
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {CONFIGMAP_NAME}
            - secretRef:
                name: {SECRET_NAME}
          volumeMounts:
            - name: {DATA_VOLUME_NAME}
              mountPath: {DATA_MOUNT_PATH}
{liveness}
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: false
            capabilities:
              drop:
                - ALL
      restartPolicy: Always
  volumeClaimTemplates:
    - metadata:
        name: {DATA_VOLUME_NAME}
      spec:
        accessModes:
          - ReadWriteOnce
        storageClassName: {STORAGE_CLASS}
        resources:
          requests:
            storage: {STORAGE_SIZE}
"""


def render_ingress(*, app_domain: str) -> str:
    """Annotation block copied verbatim from `shine/K8s/ingress.yaml` lines 6-27.

    The only substitution is `{app_domain}` in `cors-allow-origin`. shine's
    OAuth + WebSocket needs match eloup's, so the entire annotation set
    transfers without modification.
    """
    return f"""\
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {WEB_LABEL}
  namespace: {NAMESPACE}
  annotations:
    cert-manager.io/cluster-issuer: {CLUSTER_ISSUER}
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-cookie-domain: "off"
    nginx.ingress.kubernetes.io/proxy-cookie-path: "off"
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://{app_domain}"
    nginx.ingress.kubernetes.io/cors-allow-credentials: "true"
  labels:
    app: {WEB_LABEL}
spec:
  ingressClassName: {INGRESS_CLASS}
  tls:
    - hosts:
        - {app_domain}
      secretName: {TLS_SECRET}
  rules:
    - host: {app_domain}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {WEB_SERVICE_NAME}
                port:
                  number: {WEB_PORT}
"""


def render_plain_secret(runtime_secrets: dict[str, str]) -> str:
    """Plaintext Secret manifest fed to kubeseal on stdin.

    The caller must filter `runtime_secrets` to `APP_RUNTIME_SECRET_KEYS`
    before calling — this is the gate that keeps the four wizard PATs
    (DockerHub/Gitea/GitHub/Linode) out of the cluster. Phase 6 does the
    filter; this function does not re-validate, but a defensive assert
    catches caller mistakes early.
    """
    unexpected = set(runtime_secrets) - APP_RUNTIME_SECRET_KEYS
    if unexpected:
        raise ValueError(
            f"render_plain_secret refuses keys outside APP_RUNTIME_SECRET_KEYS: "
            f"{sorted(unexpected)}"
        )
    string_data_lines = "\n".join(f'  {k}: "{runtime_secrets[k]}"' for k in sorted(runtime_secrets))
    return f"""\
apiVersion: v1
kind: Secret
metadata:
  name: {SECRET_NAME}
  namespace: {NAMESPACE}
  labels:
    app: {WEB_LABEL}
type: Opaque
stringData:
{string_data_lines}
"""


def render_argocd_application(*, repo_url: str) -> str:
    return f"""\
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {APPLICATION_NAME}
  namespace: {ARGOCD_NAMESPACE}
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: {ARGOCD_PROJECT}
  source:
    repoURL: {repo_url}
    targetRevision: HEAD
    path: {ARGOCD_SOURCE_PATH}
  destination:
    server: {ARGOCD_DESTINATION_SERVER}
    namespace: {NAMESPACE}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
  revisionHistoryLimit: 3
"""


def render_repo_credential_secret(*, repo_url: str, username: str, password: str) -> str:
    """ArgoCD `argocd.argoproj.io/secret-type: repository` Secret.

    Applied via `kubectl apply -f -` (stdin) — never written to disk.
    """
    return f"""\
apiVersion: v1
kind: Secret
metadata:
  name: {REPO_SECRET_NAME}
  namespace: {ARGOCD_NAMESPACE}
  labels:
    argocd.argoproj.io/secret-type: repository
type: Opaque
stringData:
  type: git
  url: {repo_url}
  username: {username}
  password: {password}
"""
