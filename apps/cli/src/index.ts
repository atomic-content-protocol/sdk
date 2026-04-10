#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { createCommand } from './commands/create.js';
import { validateCommand } from './commands/validate.js';
import { enrichCommand } from './commands/enrich.js';
import { enrichBatchCommand } from './commands/enrich-batch.js';
import { searchCommand } from './commands/search.js';
import { serveCommand } from './commands/serve.js';
import { statsCommand } from './commands/stats.js';

const program = new Command();

program
  .name('acp')
  .description('Atomic Content Protocol CLI — create, validate, enrich, and serve ACOs')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(createCommand);
program.addCommand(validateCommand);
program.addCommand(enrichCommand);
program.addCommand(enrichBatchCommand);
program.addCommand(searchCommand);
program.addCommand(serveCommand);
program.addCommand(statsCommand);

program.parse();
