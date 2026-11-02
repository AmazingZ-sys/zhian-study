import { educationLevels, type JobInput, type Profile, type MatchResult } from '@zhian/contracts';
export function answersEqual(a: string[], b: string[]) {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    [...a].sort().join('|') === [...b].sort().join('|')
  );
}
export type Major = { code: string; name: string; category: string; aliases: string[] };
export function matchJob(profile: Profile, job: JobInput, catalog: Major[]): MatchResult {
  const reasons: MatchResult['reasons'] = [];
  const add = (field: string, status: MatchResult['status'], message: string) =>
    reasons.push({ field, status, message });
  add(
    '学历',
    educationLevels.indexOf(profile.education) >= educationLevels.indexOf(job.education) ? '符合' : '不符合',
    `要求：${job.education}；你的学历：${profile.education}`,
  );
  for (const [field, required, value] of [
    ['学位', job.degree, profile.degree],
    ['政治面貌', job.politicalStatus, profile.politicalStatus],
  ]) {
    if (required === '不限' || !required) add(field!, '符合', '无附加限制');
    else if (!value) add(field!, '需要人工确认', '尚未填写');
    else if (required === value) add(field!, '符合', '与要求一致');
    else add(field!, '需要人工确认', `要求：${required}；你的资料：${value}，需核对官方口径`);
  }
  add(
    '年龄',
    profile.age === null
      ? '需要人工确认'
      : profile.age >= job.minAge && profile.age <= job.maxAge
        ? '符合'
        : '不符合',
    `要求 ${job.minAge}–${job.maxAge} 周岁；年龄计算截止日需核对公告`,
  );
  add(
    '基层工作经历',
    profile.workYears >= job.workYears ? '符合' : '不符合',
    `要求至少 ${job.workYears} 年，具体经历认定以官方为准`,
  );
  if (job.majorText === '不限' && job.majorCodes.length === 0) add('专业', '符合', '不限专业');
  else {
    const major = catalog.find(
      (m) => m.name === profile.major || m.code === profile.major || m.aliases.includes(profile.major),
    );
    if (!major || job.majorCodes.length === 0)
      add('专业', '需要人工确认', '目录映射不足或要求为非结构化条款，请核对专业目录');
    else
      add(
        '专业',
        job.majorCodes.includes(major.code) || job.majorCodes.includes(major.category) ? '符合' : '不符合',
        `按专业目录精确编码核对：${major.name}（${major.code}）`,
      );
  }
  if (job.otherRequirements.trim()) add('其他条件', '需要人工确认', job.otherRequirements);
  if (job.status !== 'verified') add('数据状态', '需要人工确认', '当前岗位未作为正式已核验数据发布');
  return {
    status: reasons.some((r) => r.status === '不符合')
      ? '不符合'
      : reasons.some((r) => r.status === '需要人工确认')
        ? '需要人工确认'
        : '符合',
    reasons,
    disclaimer: '匹配仅供辅助筛选，不等同于官方资格审查；请以官方公告和招录单位答复为准。',
  };
}
