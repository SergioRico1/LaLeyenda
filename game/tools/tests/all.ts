import './balance.test';
import './economy.test';
import './offline.test';
import './session.test';
import './save.test';
import { runCases } from './harness';

export function run(): number {
  return runCases();
}
