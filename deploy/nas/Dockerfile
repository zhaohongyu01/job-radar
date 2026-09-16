FROM python:3.12-slim-bookworm

ARG TARGETARCH
ENV TZ=Asia/Shanghai PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git libicu72 libssl3 libkrb5-3 zlib1g liblttng-ust1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 runner

# Official GitHub Runner release, both native ARM64 (DH4300 Plus) and x64.
RUN case "$TARGETARCH" in \
      arm64) arch=arm64; checksum=9b1dc70626422526e3c94767cf024896beb15da5342a3f4819bf2feac13e0393 ;; \
      amd64) arch=x64; checksum=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613 ;; \
      *) echo "Unsupported runner architecture: $TARGETARCH"; exit 1 ;; \
    esac \
    && curl --fail --location --retry 3 -o /tmp/runner.tar.gz \
       "https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-${arch}-2.337.0.tar.gz" \
    && echo "$checksum  /tmp/runner.tar.gz" | sha256sum -c - \
    && mkdir /opt/runner-dist \
    && tar -xzf /tmp/runner.tar.gz -C /opt/runner-dist \
    && rm /tmp/runner.tar.gz

COPY deploy/nas/entrypoint.sh /usr/local/bin/nas-runner
RUN chmod +x /usr/local/bin/nas-runner \
    && mkdir -p /home/runner/state && chown runner:runner /home/runner/state
USER runner
WORKDIR /home/runner/state
ENTRYPOINT ["/usr/local/bin/nas-runner"]
