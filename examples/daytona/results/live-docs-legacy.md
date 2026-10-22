# Live Daytona run

Status: completed.

Mode: snapshot-parallel.

Corpus: docs. ACP policy: legacy. Read path: snapshot-disk.

Fork fallback reason: No runners are configured in region 'eu' for sandbox class 'linux-vm'. Try a different region or sandbox class.

The ACP arm is the legacy catalog policy (list_acos, find_similar, read_aco). Retrieval hit means the gold page was opened. The default comparison arm is search-then-read. Naive full-read is an upper bound and is sent only when ACP_LIVE_BASELINE is naive or both.
Token columns are the provider's reported usage. A null means that call did not return usage. Nothing here is estimated.

| N | Complete | ACP input | ACP output | Search input | Search output | Naive input | Naive output | ACP hit | Search hit | ACP answer | Search answer | Sum fork ms | Sum agent ms |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | yes | 85,344 | 204 | 68,248 | 158 |  |  | 0.0% | 100.0% | 0.0% | 100.0% | 3880 | 8629 |
| 10 | yes | 845,353 | 1,688 | 314,792 | 1,520 |  |  | 50.0% | 70.0% | 50.0% | 70.0% | 23131 | 74469 |

## Per question

| Question | Sandbox | ACP candidates | ACP bodies | Search opened | ACP hit | Search hit | ACP in/out | Search in/out | Naive in/out | ACP error | Search error | Naive error |
|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|
| d01 | 02dd098f-4419-4fcd-88b5-a2394e7ed99e | windows-sandboxes, macos-sandboxes, snapshots | windows-sandboxes, macos-sandboxes, snapshots | linux-sandboxes, sandboxes, windows-sandboxes | no | yes | 85344/204 | 68248/158 |  |  |  |  |
| d02 | bcf34203-98ec-4730-a567-7d7060a2ce48 | linux-sandboxes, windows-sandboxes, macos-sandboxes | linux-sandboxes, windows-sandboxes, macos-sandboxes | persistence, troubleshooting, billing | no | no | 92777/129 | 25729/141 |  |  |  |  |
| d03 | b49a6c44-6534-41ea-9ecd-ff9a69aed60c | volumes, computer-use, scale | volumes, computer-use, scale | volumes, persistence, isolation | yes | yes | 99449/120 | 24489/118 |  |  |  |  |
| d04 | 82f1a2cd-40d9-4121-ab31-37b3cfe47a62 | troubleshooting, organizations, warm-pools | troubleshooting, organizations, warm-pools | troubleshooting, network-limits, isolation | no | yes | 76740/149 | 35394/150 |  |  |  |  |
| d05 | 0aa77713-97c4-4286-b6d0-e7293ead1169 | file-system-operations, authentication, observability-otel-collection | file-system-operations, authentication, observability-otel-collection | vpn-connections, authentication, mount-external-storage | yes | yes | 74386/156 | 52419/148 |  |  |  |  |
| d06 | e388af36-2083-4af6-b663-91874fc812c5 | process-code-execution, computer-use, git-operations | process-code-execution, computer-use, git-operations | macos-sandboxes, vnc-access, playground | yes | no | 98491/247 | 7610/167 |  |  |  |  |
| d07 | abe32a16-2823-496c-b783-e28c4f54f83e | declarative-builder, git-operations, file-system-operations | declarative-builder, git-operations, file-system-operations | declarative-builder, snapshots, architecture | yes | yes | 82174/194 | 26064/212 |  |  |  |  |
| d08 | 5a7ef40c-d53d-4b4e-9ff1-5c427261a43b | macos-sandboxes, linux-sandboxes, warm-pools | macos-sandboxes, linux-sandboxes, warm-pools | troubleshooting, typescript-sdk, warm-pools | yes | yes | 80568/155 | 21719/191 |  |  |  |  |
| d09 | 1a110ddb-b853-4bbf-af09-dfeda5ba354d | macos-sandboxes, linux-sandboxes, api-keys | macos-sandboxes, linux-sandboxes, api-keys | vpn-connections, git-operations, isolation | no | no | 80603/173 | 30004/120 |  |  |  |  |
| d10 | 62664749-6134-40dc-ab71-3b2693c18c10 | git-operations, file-system-operations, macos-sandboxes | git-operations, file-system-operations, macos-sandboxes | secrets, isolation, tools-api | no | yes | 74821/161 | 23116/115 |  |  |  |  |
