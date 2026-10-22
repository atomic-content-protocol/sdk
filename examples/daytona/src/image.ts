/**
 * Sandbox image for the Daytona benchmark.
 *
 * `containerImage` is what `daytona.snapshot.create` builds for container
 * sandboxes (`Image.fromDockerfile` in @daytonaio/sdk 0.226.0). Linux VM
 * snapshots cannot be built from a Dockerfile; the live harness creates those
 * from the public `node:22-bookworm-slim` image and installs the CLI inside
 * the parent before `sandbox.createSnapshot`.
 */

import path from "node:path";
import { Image, SandboxClass } from "@daytonaio/sdk";
import { EXAMPLE_ROOT } from "./policy.js";

export const VM_BASE_IMAGE = "node:22-bookworm-slim";
export const CLI_VERSION = "0.3.2";
export const VOLUME_NAME = "acp-daytona-corpus";
export const VOLUME_MOUNT = "/home/daytona/corpus";

export function containerImage(): Image {
  return Image.fromDockerfile(path.join(EXAMPLE_ROOT, "Dockerfile"));
}

export { SandboxClass };
