import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export async function runProvisionPlaybook(data) {
  const { user_id, game, ports, mode } = data;
  const cmd = `ansible-playbook provision.yml --extra-vars 'user_id=${user_id} game=${game} ports=${ports} mode=${mode}'`;
  const { stdout, stderr } = await execAsync(cmd);
  if (stderr) throw new Error(stderr);
  console.log(stdout);
}
