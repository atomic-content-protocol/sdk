# Live Daytona run

Status: completed.

Mode: snapshot-parallel.

Corpus: docs. ACP policy: summary-first. Read path: snapshot-disk.

Fork fallback reason: No runners are configured in region 'eu' for sandbox class 'linux-vm'. Try a different region or sandbox class.

The ACP arm is summary-first. Retrieval hit means the gold page was a summary candidate. The default comparison arm is search-then-read. Naive full-read is an upper bound and is sent only when ACP_LIVE_BASELINE is naive or both.
Token columns are the provider's reported usage. A null means that call did not return usage. Nothing here is estimated.

| N | Complete | ACP input | ACP output | Search input | Search output | Naive input | Naive output | ACP hit | Search hit | ACP answer | Search answer | Sum fork ms | Sum agent ms |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | yes | 34,543 | 218 | 68,248 | 172 |  |  | 0.0% | 100.0% | 0.0% | 100.0% | 3676 | 8587 |
| 10 | yes | 157,792 | 1,136 | 314,792 | 1,496 |  |  | 90.0% | 70.0% | 60.0% | 70.0% | 20609 | 58493 |
| 20 | yes | 286,314 | 2,260 | 643,400 | 3,005 |  |  | 90.0% | 80.0% | 60.0% | 75.0% | 31253 | 116818 |

## Per question

| Question | Sandbox | ACP candidates | ACP bodies | Search opened | ACP hit | Search hit | ACP in/out | Search in/out | Naive in/out | ACP error | Search error | Naive error |
|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|
| d01 | 40e36630-ce23-4e0a-8afe-fa5afc742ab1 | windows-sandboxes, declarative-builder, snapshots | windows-sandboxes, declarative-builder, snapshots | linux-sandboxes, sandboxes, windows-sandboxes | no | yes | 34543/218 | 68248/172 |  |  |  |  |
| d02 | 46412015-8bb7-4c33-b223-fcd79df5baa0 | snapshots, windows-sandboxes, linux-sandboxes |  | persistence, troubleshooting, billing | yes | no | 253/87 | 25729/133 |  |  |  |  |
| d03 | d01a4b1b-2eb3-4730-8ab9-9ae38a7af907 | volumes, mount-external-storage, scale | volumes, mount-external-storage, scale | volumes, persistence, isolation | yes | yes | 55404/127 | 24489/107 |  |  |  |  |
| d04 | c481dfc6-72bf-4fd9-a686-041a427df2fc | organizations, api-keys, network-limits | organizations, api-keys, network-limits | troubleshooting, network-limits, isolation | yes | yes | 20271/131 | 35394/147 |  |  |  |  |
| d05 | e10d97ef-a8ad-4137-bd3c-86e345af5854 | file-system-operations, authentication, preview |  | vpn-connections, authentication, mount-external-storage | yes | yes | 289/78 | 52419/148 |  |  |  |  |
| d06 | 983f9579-2843-42ee-9f51-d47f8f2e8e0d | computer-use, vnc-access, file-system-operations |  | macos-sandboxes, vnc-access, playground | yes | no | 240/62 | 7610/168 |  |  |  |  |
| d07 | 59aa4448-3b15-487f-b6bf-bceb224d3926 | declarative-builder, gpu-sandboxes, file-system-operations |  | declarative-builder, snapshots, architecture | yes | yes | 287/94 | 26064/203 |  |  |  |  |
| d08 | ef01bb49-56ec-43e3-b8d1-471a60327070 | warm-pools, authentication, volumes | warm-pools, authentication, volumes | troubleshooting, typescript-sdk, warm-pools | yes | yes | 15350/115 | 21719/175 |  |  |  |  |
| d09 | d443f6f2-0ab3-427e-a35f-e42a016ffc1f | ssh-access, authentication, secrets |  | vpn-connections, git-operations, isolation | yes | no | 279/53 | 30004/104 |  |  |  |  |
| d10 | 31eecc45-d1bb-43f4-b658-4fde55c0bd08 | secrets, file-system-operations, troubleshooting | secrets, file-system-operations, troubleshooting | secrets, isolation, tools-api | yes | yes | 30876/171 | 23116/139 |  |  |  |  |
| d11 | ea167e1c-3dcb-4448-a743-0dd2e9e26ad7 | webhooks, limits, tools-cli | webhooks, limits, tools-cli | webhooks, limits, acceptable-use | yes | yes | 11886/121 | 11116/153 |  |  |  |  |
| d12 | 79ba450b-8cdf-4f94-a9fc-12cdbf13dd86 | typescript-sdk, tools-cli, agent-skills |  | typescript-sdk, mount-external-storage, network-limits | yes | yes | 281/102 | 52220/70 |  |  |  |  |
| d13 | 1df17d53-f291-49e9-97ce-fdaf1f566a1a | preview, custom-preview-proxy, ssh-access | preview, custom-preview-proxy, ssh-access | preview, isolation, tools-api | yes | yes | 5066/194 | 16993/214 |  |  |  |  |
| d14 | ed8188e5-92b1-42a7-bcd4-70146ce048c9 | log-streaming, audit-logs, process-code-execution |  | log-streaming, process-code-execution, declarative-builder | yes | yes | 224/55 | 24905/135 |  |  |  |  |
| d15 | 5ef3f9cd-89ed-44d8-9ccf-cca771f009ec | regions, warm-pools, scale |  | regions, scale, acceptable-use | yes | yes | 305/44 | 17095/84 |  |  |  |  |
| d01 | cd66acf0-190d-43c4-bcfa-9c54ff23ea9e | windows-sandboxes, declarative-builder, snapshots | windows-sandboxes, declarative-builder, snapshots | linux-sandboxes, sandboxes, windows-sandboxes | no | yes | 34543/211 | 68248/151 |  |  |  |  |
| d02 | 8e9ab6e2-d92b-4b34-af59-18690d9a70a9 | snapshots, windows-sandboxes, linux-sandboxes |  | persistence, troubleshooting, billing | yes | no | 253/81 | 25729/147 |  |  |  |  |
| d03 | 76f9f2ed-a269-4b68-883a-cd48438a91f5 | volumes, mount-external-storage, scale | volumes, mount-external-storage, scale | volumes, persistence, isolation | yes | yes | 55404/108 | 24489/144 |  |  |  |  |
| d04 | 9faf2b20-61d4-4aaf-95df-f41edadfa0f0 | organizations, api-keys, network-limits | organizations, api-keys, network-limits | troubleshooting, network-limits, isolation | yes | yes | 20271/132 | 35394/218 |  |  |  |  |
| d05 | e6dca16a-4637-4b75-8e48-f027be6a596f | file-system-operations, authentication, preview |  | vpn-connections, authentication, mount-external-storage | yes | yes | 289/76 | 52419/193 |  |  |  |  |
