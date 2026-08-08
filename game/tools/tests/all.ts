import './balance.test';
import './economy.test';
import './offline.test';
import './build.test';
import './session.test';
import './retention.test';
import './save.test';
import './tokens.test';
import './decor.test';
import './sea.test';
import { runCases } from './harness';

export function run(): number {
  return runCases();
}
