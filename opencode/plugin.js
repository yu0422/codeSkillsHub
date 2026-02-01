import { SkillsInstallerPlugin as CodeSkillsHubPlugin } from './plugins/codeSkillsHub.js';

export const Plugin = async (ctx) => {
  return CodeSkillsHubPlugin(ctx);
};

export default Plugin;
