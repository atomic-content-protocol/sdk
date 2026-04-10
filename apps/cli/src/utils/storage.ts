import { FilesystemAdapter } from '@acp/core';
import type { ACPConfig } from './config.js';

export function createStorage(config: ACPConfig): FilesystemAdapter {
  return new FilesystemAdapter(config.vault_path);
}
