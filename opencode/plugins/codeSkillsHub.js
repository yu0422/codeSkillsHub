import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_SKILLS_COMMAND = 'skills-hub';
const DEFAULT_RECOMMENDED_REPO = 'https://github.com/yu0422/codeSkillsHub.git';
const DEFAULT_RECOMMENDED_BRANCH = 'main';

const sanitizeCollectionName = (raw) => {
  if (!raw || typeof raw !== 'string') return 'local-skills';
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
  return cleaned || 'local-skills';
};

const normalizePath = (maybePath, homeDir) => {
  if (!maybePath || typeof maybePath !== 'string') return null;
  let normalized = maybePath.trim();
  if (!normalized) return null;
  if (normalized.startsWith('~/')) {
    normalized = path.join(homeDir, normalized.slice(2));
  } else if (normalized === '~') {
    normalized = homeDir;
  }
  return path.resolve(normalized);
};

const discoverSkills = (root) => {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(root, entry.name),
      hasSkillFile: fs.existsSync(path.join(root, entry.name, 'SKILL.md'))
    }))
    .filter((entry) => entry.hasSkillFile)
    .map((entry) => ({ name: entry.name, path: entry.path }));
};

const ensureSymlink = ({ source, target }) => {
  const normalizedSource = path.resolve(source);
  const targetDirname = path.dirname(target);
  fs.mkdirSync(targetDirname, { recursive: true });

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';

  const existingRealpath = fs.existsSync(target)
    ? (() => {
        try {
          return fs.realpathSync(target);
        } catch (err) {
          return null;
        }
      })()
    : null;

  if (existingRealpath && path.resolve(existingRealpath) === normalizedSource) {
    return { status: 'already-installed', target };
  }

  if (fs.existsSync(target)) {
    const stats = fs.lstatSync(target);
    const safeToRemove = stats.isSymbolicLink() || stats.isFile();
    if (!safeToRemove) {
      return { status: 'conflict', target };
    }
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(target);
    } else {
      fs.rmSync(target, { force: true });
    }
  }

  try {
    fs.symlinkSync(normalizedSource, target, linkType);
    return { status: 'linked', target };
  } catch (error) {
    return { status: 'error', error };
  }
};

const toPosixPath = (maybePath) => maybePath.split(path.sep).join('/');

const normalizeRepoUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
};

const sanitizeCommandName = (raw) => {
  if (!raw || typeof raw !== 'string') return DEFAULT_SKILLS_COMMAND;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_SKILLS_COMMAND;
};

const readInstalledCollections = (root) => {
  if (!root || !fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink && entry.isSymbolicLink()))
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      let stats;
      try {
        stats = fs.lstatSync(fullPath);
      } catch (error) {
        return null;
      }

      let resolved = null;
      try {
        resolved = fs.realpathSync(fullPath);
      } catch (error) {
        resolved = null;
      }

      const skills = resolved ? discoverSkills(resolved).map((skill) => skill.name) : [];

      if (!skills.length) {
        return null;
      }

      return {
        name: entry.name,
        path: fullPath,
        resolved,
        isLink: stats.isSymbolicLink(),
        skills
      };
    })
    .filter(Boolean);
};

const buildRecommendedList = ({ skillsRoot, repoRoot, repoUrl, branch }) => {
  const normalizedUrl = normalizeRepoUrl(repoUrl);
  if (!normalizedUrl) return [];
  const safeBranch = branch && branch.trim() ? branch.trim() : DEFAULT_RECOMMENDED_BRANCH;

  return discoverSkills(skillsRoot).map((skill) => {
    const relativePath = path.relative(repoRoot, skill.path) || skill.name;
    const normalizedPath = relativePath ? toPosixPath(relativePath) : '';
    const skillUrl = normalizedPath
      ? `${normalizedUrl}/tree/${safeBranch}/${normalizedPath}`
      : `${normalizedUrl}/tree/${safeBranch}`;
    return {
      name: skill.name,
      url: skillUrl
    };
  });
};

const formatInstalledSection = (collections, commandName) => {
  if (!collections.length) {
    return '- 未检测到技能目录。';
  }

  return collections
    .map((collection) => {
      const header = `- ${collection.name}${collection.isLink ? ' (链接)' : ''}`;
      const location = `  路径：${collection.path}`;
      const skillsList = collection.skills.length
        ? collection.skills.map((skill) => `  · ${skill}`).join('\n')
        : '  · (未发现 SKILL.md)';
      const uninstallHint = collection.isLink
        ? `  卸载：/${commandName} uninstall ${collection.name}`
        : '  卸载：请手动删除该目录（非链接）';
      return [header, location, skillsList, uninstallHint].join('\n');
    })
    .join('\n\n');
};

const formatRecommendedSection = (recommended, repoUrl) => {
  if (!recommended.length) {
    return repoUrl
      ? `- 访问 ${repoUrl} 获取更多技能`
      : '- 暂无推荐（设置 OPENCODE_SKILLS_RECOMMEND_URL 指定 GitHub 仓库）';
  }

  const header = repoUrl ? `- GitHub 仓库：${repoUrl}` : '- 推荐技能：';
  const list = recommended.map((item) => `  · ${item.name} → ${item.url}`).join('\n');
  return `${header}\n${list}`;
};

const buildSkillsOverview = ({ installed, recommended, repoUrl, commandName }) => {
  const usage = [
    '用法：',
    `  /${commandName}                查看技能目录概览`,
    `  /${commandName} uninstall <目录> 卸载某个技能目录（仅移除链接，不删除仓库）`
  ].join('\n');

  const installedSection = `已安装技能包（${installed.length}）\n${formatInstalledSection(
    installed,
    commandName
  )}`;
  const recommendedSection = `推荐下载\n${formatRecommendedSection(recommended, repoUrl)}`;

  return ['技能目录', usage, installedSection, recommendedSection].join('\n\n');
};

const uninstallCollection = (root, name) => {
  if (!name) {
    return { status: 'missing-name' };
  }
  if (!root || !fs.existsSync(root)) {
    return { status: 'missing-root' };
  }

  const target = path.join(root, name);
  if (!fs.existsSync(target)) {
    return { status: 'not-found', target };
  }

  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    return { status: 'not-found', target };
  }

  if (!stats.isSymbolicLink()) {
    return { status: 'not-link', target };
  }

  try {
    fs.unlinkSync(target);
    return { status: 'removed', target };
  } catch (error) {
    return { status: 'error', target, error };
  }
};

const createSkillsCommandHandler = ({
  commandName,
  skillsTargetRoot,
  skillsRoot,
  repoRoot,
  recommendedRepoUrl,
  recommendedBranch
}) => {
  return async (input, output) => {
    if (input.command !== commandName) {
      return;
    }

    const recommended = buildRecommendedList({
      skillsRoot,
      repoRoot,
      repoUrl: recommendedRepoUrl,
      branch: recommendedBranch
    });

    const renderOverview = (message, installedOverride) => {
      const installed = installedOverride ?? readInstalledCollections(skillsTargetRoot);
      const overview = buildSkillsOverview({
        installed,
        recommended,
        repoUrl: recommendedRepoUrl,
        commandName
      });
      return message ? `${message}\n\n${overview}` : overview;
    };

    const args = input.arguments?.trim() ?? '';
    const normalizedArgs = args.toLowerCase();
    let text;

    if (!args || normalizedArgs === 'list') {
      text = renderOverview('', readInstalledCollections(skillsTargetRoot));
    } else if (normalizedArgs.startsWith('uninstall')) {
      const [, ...rest] = args.split(/\s+/);
      const target = rest.join(' ').trim();

      if (!target) {
        text = renderOverview(
          `请提供要卸载的目录名称，例如 \`/${commandName} uninstall skills\`。`
        );
      } else {
        const result = uninstallCollection(skillsTargetRoot, target);
        switch (result.status) {
          case 'removed':
            text = renderOverview(`已卸载技能目录 \`${target}\`。`);
            break;
          case 'not-found':
            text = renderOverview(
              `未在 ${skillsTargetRoot} 中找到 \`${target}\`。`
            );
            break;
          case 'not-link':
            text = renderOverview(
              `\`${target}\` 不是符号链接，为避免误删不会自动删除。请确认后手动移除。`
            );
            break;
          case 'missing-root':
            text = renderOverview('尚未创建技能安装根目录，无法执行卸载。');
            break;
          case 'missing-name':
            text = renderOverview('请提供要卸载的目录名称。');
            break;
          case 'error':
            text = renderOverview(`卸载失败：${result.error?.message || result.error}`);
            break;
          default:
            text = renderOverview('无法确定卸载结果，请稍后重试。');
        }
      }
    } else {
      text = renderOverview(
        `未识别的子命令：\`${args}\`。可用命令：/${commandName}、/${commandName} uninstall <目录>。`
      );
    }

    output.parts ||= [];
    output.parts.push({ type: 'text', text });
  };
};

export const SkillsInstallerPlugin = async ({ directory }) => {
  const repoRoot = path.resolve(directory ?? '.');
  const candidateSkillsDir = path.join(repoRoot, 'skills');
  const skillsRoot = fs.existsSync(candidateSkillsDir) ? candidateSkillsDir : repoRoot;
  const discovered = discoverSkills(skillsRoot);

  const homeDir = os.homedir();
  const envConfigDir = normalizePath(process.env?.OPENCODE_CONFIG_DIR, homeDir);
  const configDir = envConfigDir || path.join(homeDir, '.config/opencode');
  const skillsTargetRoot = path.join(configDir, 'skills');
  const collectionName = sanitizeCollectionName(
    process.env?.OPENCODE_SKILLS_COLLECTION || path.basename(repoRoot) || 'local-skills'
  );
  const targetLink = path.join(skillsTargetRoot, collectionName);
  const rawRecommendedUrl = process.env?.OPENCODE_SKILLS_RECOMMEND_URL;
  const recommendedRepoUrl =
    rawRecommendedUrl === undefined
      ? DEFAULT_RECOMMENDED_REPO
      : normalizeRepoUrl(rawRecommendedUrl);
  const recommendedBranch =
    process.env?.OPENCODE_SKILLS_RECOMMEND_BRANCH?.trim() || DEFAULT_RECOMMENDED_BRANCH;
  const commandName = sanitizeCommandName(process.env?.OPENCODE_SKILLS_COMMAND);

  let installResult = { status: 'no-skills' };
  if (discovered.length) {
    installResult = ensureSymlink({ source: skillsRoot, target: targetLink });
  }

  const listSkills = discovered.map((skill) => `- ${collectionName}/${skill.name}`).join('\n');
  const installStatusText = (() => {
    switch (installResult.status) {
      case 'linked':
        return `Linked local skills to \`${targetLink}\`.`;
      case 'already-installed':
        return `Local skills already linked at \`${targetLink}\`.`;
      case 'conflict':
        return `Could not overwrite \`${targetLink}\` because it already exists. Remove it manually if you want this plugin to manage the link.`;
      case 'error':
        return `Failed to link skills: ${installResult.error?.message || installResult.error}`;
      default:
        return 'No skills discovered in this repository.';
    }
  })();

  const bootstrap = discovered.length
    ? `<EXTREMELY_IMPORTANT>
Local project skills are available under the namespace \"${collectionName}\".

${installStatusText}

Available skills:
${listSkills || '- (none detected)'}

Use OpenCode's \`skill\` tool to load them, e.g. \`use skill tool to load ${collectionName}/${discovered[0]?.name}\`.

运行 \`/${commandName}\` 可随时查看已安装与推荐的技能目录，并可使用 \`/${commandName} uninstall <目录>\` 解除链接。
</EXTREMELY_IMPORTANT>`
    : null;

  const hooks = {};

  if (bootstrap) {
    hooks['experimental.chat.system.transform'] = async (_input, output) => {
      (output.system ||= []).push(bootstrap);
    };
  }

  hooks['command.execute.before'] = createSkillsCommandHandler({
    commandName,
    skillsTargetRoot,
    skillsRoot,
    repoRoot,
    recommendedRepoUrl,
    recommendedBranch
  });

  return hooks;
};
