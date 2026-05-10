# syntax=docker/dockerfile:1.6
# bholcombe/eloup-wizard:latest — AMD64-only deployment wizard for EloUp.
#
# Bundled tools (pinned versions):
#   - kubectl   v1.33.0     (cluster API)
#   - argocd    v2.13.1     (Application registration / sync)
#   - docker    27.5.1      (CLI; daemon comes from the mounted host socket)
#   - kubeseal  v0.27.1     (Sealed Secrets cert fetch + encrypt for phase 6)
#
# Run with:
#   docker run --rm -it \
#     -v ~/.kube:/root/.kube:ro \
#     -v ~/.config/eloup-wizard:/root/.config/eloup-wizard \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     -v "$(pwd)":/workspace \
#     bholcombe/eloup-wizard:latest

FROM --platform=linux/amd64 python:3.11-slim AS base

ARG KUBECTL_VERSION=v1.33.0
ARG ARGOCD_VERSION=v2.13.1
ARG DOCKER_CLI_VERSION=27.5.1
ARG KUBESEAL_VERSION=v0.27.1

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates curl git tini \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    curl -fsSLo /usr/local/bin/kubectl \
        "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"; \
    chmod 0755 /usr/local/bin/kubectl; \
    kubectl version --client=true --output=yaml >/dev/null

RUN set -eux; \
    curl -fsSLo /usr/local/bin/argocd \
        "https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_VERSION}/argocd-linux-amd64"; \
    chmod 0755 /usr/local/bin/argocd; \
    argocd version --client >/dev/null

RUN set -eux; \
    curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
        | tar -xz -C /tmp; \
    install -m 0755 /tmp/docker/docker /usr/local/bin/docker; \
    rm -rf /tmp/docker; \
    docker --version

RUN set -eux; \
    KUBESEAL_VERSION_NO_V="${KUBESEAL_VERSION#v}"; \
    curl -fsSL "https://github.com/bitnami-labs/sealed-secrets/releases/download/${KUBESEAL_VERSION}/kubeseal-${KUBESEAL_VERSION_NO_V}-linux-amd64.tar.gz" \
        | tar -xz -C /tmp kubeseal; \
    install -m 0755 /tmp/kubeseal /usr/local/bin/kubeseal; \
    rm -f /tmp/kubeseal; \
    kubeseal --version

WORKDIR /app
COPY wizard/ /app/wizard/
RUN pip install --no-cache-dir -e /app/wizard

WORKDIR /workspace

ENTRYPOINT ["tini", "--", "python", "-m", "wizard"]
CMD []
