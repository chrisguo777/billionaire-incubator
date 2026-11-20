// Conservative, synchronous checks for numerical claims. These rules compare
// cited text, not external truth; an ambiguous binding must not get a green pass.
export interface NumericSource {
  id: string;
  text: string;
  cardId: string;
  team?: boolean;
  basis?: string | null;
}

type Claim = {
  value: number;
  label: string;
  unit: string;
  metric: string[];
  clause: string;
  direction: string;
  relation: string;
  restrictions: Set<string>;
  team: boolean;
  baseline: string[];
};

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/−/g, "-").replace(/\s+/g, " ").trim();
const EN_NUMBERS: Record<string, number> = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
  seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50,
  sixty:60, seventy:70, eighty:80, ninety:90,
};
const EN_NUMBER = `(?:${Object.keys(EN_NUMBERS).join("|")}|hundred|thousand|million|billion)`;
const NUMBER = new RegExp(`[-+]?(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)(?:[kmb]\\b|\\s+(?:hundred|thousand|million|billion)\\b|[万亿])?|\\b${EN_NUMBER}(?:(?:[ -]+(?:and[ -]+)?)${EN_NUMBER})*\\b|[负零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?(?=(?:个|份|名|人|条|项|次|家|张|本|台|件|页|倍|年|月|天|小时|分钟|秒|元|%|个百分点))|(?<=百分之)[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?`, "gu");

function numberValue(raw: string): number {
  if (/^[-+]?[\d.]/.test(raw)) {
    const suffix = raw.match(/(?:[kmb万亿]|hundred|thousand|million|billion)$/)?.[0];
    const scale: Record<string,number> = { k:1e3, m:1e6, b:1e9, 万:1e4, 亿:1e8, hundred:100, thousand:1e3, million:1e6, billion:1e9 };
    return Number(raw.replace(/,/g, "").replace(/(?:[kmb万亿]|hundred|thousand|million|billion)$/, "").trim()) * (suffix ? scale[suffix] : 1);
  }
  if (/^[a-z]/.test(raw)) {
    let total=0, group=0;
    for (const word of raw.split(/[ -]+/)) {
      if (word === "hundred") group=(group || 1)*100;
      else if (word === "thousand" || word === "million" || word === "billion") { total+=(group || 1)*({ thousand:1e3, million:1e6, billion:1e9 }[word]); group=0; }
      else group+=EN_NUMBERS[word] ?? 0;
    }
    return total+group;
  }
  const digits: Record<string, number> = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
  const [integer, decimal] = raw.replace(/^负/, "").split("点");
  let total=0, section=0, digit=0;
  for (const char of integer) {
    if (char in digits) digit=digits[char];
    else if (char === "万" || char === "亿") { total+=(section+digit)*(char === "万" ? 1e4 : 1e8); section=0; digit=0; }
    else { section+=(digit || 1)*({ 十:10, 百:100, 千:1000 }[char] ?? 1); digit=0; }
  }
  const fraction=decimal ? Number(`0.${[...decimal].map(c=>digits[c]).join("")}`) : 0;
  return (total+section+digit+fraction)*(raw.startsWith("负") ? -1 : 1);
}

// Units are deliberately not converted: 18 hours cannot support 18 days, and a
// percentage-point change cannot support a relative percentage change.
function unitOf(before: string, after: string): { unit: string; tail: string } {
  const units: [string, RegExp][] = [
    ["pp", /^\s*(?:percentage[ -]points?|percent[ -]points?|pp\b|个百分点)/],
    ["percent", /^\s*(?:%|percent(?:age)?\b|per cent\b)/],
    ["hour", /^[\s-]*(?:hours?\b|hrs?\b|小时)/],
    ["day", /^[\s-]*(?:days?\b|天)/],
    ["minute", /^[\s-]*(?:minutes?\b|mins?\b|分钟)/],
    ["second", /^[\s-]*(?:seconds?\b|secs?\b|秒)/],
    ["month", /^[\s-]*(?:months?\b|个月|月)/],
    ["year", /^[\s-]*(?:years?\b|年)/],
    ["multiple", /^\s*(?:times\b|x\b|倍)/],
    ["USD", /^\s*(?:usd\b|dollars?\b)/], ["EUR", /^\s*(?:eur\b|euros?\b)/],
    ["GBP", /^\s*(?:gbp\b|pounds?\b)/], ["CNY", /^\s*(?:cny\b|rmb\b|元)/],
  ];
  for (const [unit, pattern] of units) {
    const match=after.match(pattern);
    if (match) return { unit, tail:after.slice(match[0].length) };
  }
  if (/百分之\s*$/.test(before)) return { unit:"percent", tail:after };
  const currency=before.match(/(?:\b(usd|eur|gbp|cny|rmb)|([$€£¥]))\s*$/);
  if (currency) return { unit:({ usd:"USD", eur:"EUR", gbp:"GBP", cny:"CNY", rmb:"CNY", $:"USD", "€":"EUR", "£":"GBP", "¥":"CNY" } as Record<string,string>)[currency[1] || currency[2]], tail:after };
  return { unit:"count", tail:after.replace(/^\s*(?:个|份|名|条|项|次|家|张|本|台|件|页)/, "") };
}

const STOP = new Set(("i we my our the a an of by to for from with in on at as and or but using used use " +
  "was were is are had has have it its this that those these no not any approximately about around estimated roughly " +
  "approximately minimum maximum least most more less than up over under only per not yet verified unverified " +
  "usd eur gbp cny rmb percent percentage points point change growth gain increase reduction effect impact " +
  "reconciled reconcile validated validate checked check reviewed review analyzed analyse analysed analyze " +
  "processed process built build created create generated generate acquired acquire produced produce " +
  "managed manage observed observe found find measured measure increased increase raised raise grew grow improved improve " +
  "reduced reduce lowered lower decreased decrease cut saved save achieved achieve completed complete " +
  "contributed contribute collaborated collaborate helped help supported support documented document " +
  "reported report_to based into through approximately classroom class course synthetic simulated simulation production " +
  "compared compare relative versus vs basis").split(/\s+/));
const ALIASES: Record<string,string> = { rows:"record", row:"record", records:"record", datasets:"dataset", codes:"code", responses:"response", reports:"report", people:"person", persons:"person", employees:"employee", clients:"customer", client:"customer", customers:"customer", hours:"hour", years:"year", sales:"sales", data:"data", previous:"previous", prior:"previous", last:"previous" };
function metricTokens(text: string): string[] {
  // Common Chinese CV nouns share canonical tokens with their English forms.
  let value=text;
  for (const [pattern, replacement] of [
    [/分类代码/g," category code "], [/销售额|销售/g," sales "], [/客户/g," customer "],
    [/问卷回复|问卷答复|问卷响应/g," survey response "], [/报告|报表/g," report "],
    [/记录/g," record "], [/错误率/g," error rate "], [/转化率/g," conversion rate "],
    [/流失率/g," churn rate "], [/收入/g," revenue "], [/成本/g," cost "], [/预算/g," budget "],
    [/缺失的?/g," missing "], [/核对|并补齐|补齐|新增|提升|增长|增加|降低|减少|处理|完成|了|的/g," "],
  ] as [RegExp,string][]) value=value.replace(pattern,replacement);
  return [...new Set((value.match(/[a-z][a-z_]*|[\p{Script=Han}]+/gu) ?? [])
    .filter(token=>!STOP.has(token))
    .map(token=>ALIASES[token] ?? token.replace(/ies$/, "y").replace(/(?<!s)s$/, "")))];
}

function comparisonTokens(local: string, basis = ""): string[] {
  const explicit=local.match(/\b(?:compared (?:with|to)|relative to|versus|vs)\s+(.+?)(?:[;。]|$)/)?.[1] ?? "";
  const text=`${explicit} ${basis}`;
  return [...new Set([...metricTokens(text), ...[...text.matchAll(NUMBER)].map(match=>String(numberValue(match[0])))])];
}

function restrictions(local: string, whole: string, basis: string): Set<string> {
  const result=new Set<string>();
  const scoped=`${local} ${basis}`;
  const affirmative=scoped.replace(/\b(?:not|never|without|outside)(?:\s+(?:in|a|an|the|using|based|on))*\s+(?:classroom|class|course|synthetic|simulated|simulation|approximately|approximate|estimated|estimate|roughly)\b/g, "");
  if (/\b(?:about|around|approximately|approx\.?|roughly|estimated|estimate)\b|[~≈]|大约|约|估算/.test(affirmative)) result.add("估算");
  if (/\b(?:at least|a minimum of)\b|至少|不低于/.test(scoped)) result.add("至少");
  if (/\b(?:more than|over)\b|超过/.test(scoped.replace(/不超过/g,""))) result.add("超过");
  if (/\b(?:at most|a maximum of|up to)\b|至多|最多|不超过/.test(scoped)) result.add("至多");
  if (/\b(?:less than|under)\b|低于/.test(scoped.replace(/不低于/g,""))) result.add("少于");
  if (/\d\s*[-–—~至到]\s*\d|\bbetween\b/.test(local)) result.add("范围");
  if (/\b(?:unverified|unconfirmed|not (?:yet )?(?:verified|checked|confirmed|validated|audited)|unchecked|pending verification)\b|尚未核实|未核实|待核实|待确认|未经确认|未核验/.test(`${whole} ${basis}`)) result.add("未核实");
  if (/\b(?:classroom|class|course|coursework)\b|课程|课堂/.test(affirmative)) result.add("课程场景");
  if (/\b(?:synthetic|simulated|simulation)\b|合成数据|模拟/.test(affirmative)) result.add("模拟场景");
  if (/\b(?:no|not|never|without)\b|没有|未曾|未衡量|未测量/.test(local.replace(/not (?:yet )?(?:verified|checked|confirmed)/g, ""))) result.add("否定");
  for (const [label, pattern] of [
    ["每日", /\bdaily\b|\bper day\b|每天|每日/], ["每月", /\bmonthly\b|\bper month\b|每月/], ["每年", /\bannual(?:ly)?\b|\bper year\b|每年|年度/],
  ] as [string,RegExp][]) if (pattern.test(scoped)) result.add(label);
  return result;
}

function isTeam(text: string): boolean {
  if (/\b(?:independently|single-handedly|solely)\b|独立|独自/.test(text)) return false;
  if (/\b(?:contribut\w*|collaborat\w*|helped|supported)\b.*\b(?:team|company|department|organization|group)\b|参与团队|协助团队/.test(text)) return true;
  if (/\bi\b|我独立|本人独立/.test(text)) return false;
  return /\b(?:our team|the team|team (?:produced|built|created|delivered|total)|we|(?:company|department|organization|group) (?:generated|produced|achieved|increased|delivered|sales|revenue))\b|团队|全公司/.test(text);
}
function direction(text: string): string {
  if (/\b(?:increas\w*|rais\w*|grew|grow\w*|boost\w*|improv\w*|growth|gain\w*)\b|增长|提升|增加/.test(text)) return "increase";
  if (/\b(?:reduc\w*|decreas\w*|lower\w*|cut|sav\w*|declin\w*|fell)\b|减少|降低|节省/.test(text)) return "decrease";
  return "";
}

function claims(text: string, basis = "", team = false): Claim[] {
  const whole=normalize(text), context=normalize(basis);
  const result: Claim[]=[];
  // Semicolons, full stops and nonnumeric commas bound a statement. Numeric
  // bindings never come from the concatenation of different sources/clauses.
  for (const clause of whole.split(/[;\n。!?]|\.(?!\d)|,(?!\d)/u).filter(Boolean)) {
    const numbers=[...clause.matchAll(NUMBER)];
    for (let i=0; i<numbers.length; i++) {
      const match=numbers[i], start=match.index!, end=start+match[0].length;
      const previous=i ? numbers[i-1].index!+numbers[i-1][0].length : 0;
      const next=numbers[i+1]?.index ?? clause.length;
      const before=clause.slice(previous,start).split(/\band\b|\bbut\b|，/).at(-1) ?? "";
      const after=clause.slice(end,next);
      const unit=unitOf(before,after);
      const post=unit.tail.split(/\b(?:and|but|using|with|for|in|from|compared|versus|vs|relative|rather)\b|，/)[0];
      const afterMetric=metricTokens(post);
      const metric=afterMetric.length ? afterMetric : metricTokens(before);
      const local=`${before} ${match[0]} ${unit.tail.split(/\b(?:and|but)\b/)[0]}`;
      const trend=direction(local);
      const relation=/\bto\s*(?:(?:about|approximately)\s*)?$|至\s*$|达到\s*$/.test(before) ? "to" : trend ? "by" : "level";
      const value=numberValue(match[0])*(/\b(?:minus|negative)\s*$|负\s*$|[-−]\s+$/.test(before) ? -1 : 1);
      result.push({ value, label:match[0]+(unit.unit === "percent" ? "%" : ""), unit:unit.unit,
        metric, clause:clause.trim(), direction:trend, relation,
        restrictions:restrictions(local,whole,context), team:team || isTeam(`${local} ${context}`),
        baseline:comparisonTokens(local,context) });
    }
  }
  return result;
}

function metricMatches(source: Claim, target: Claim): boolean {
  // Generalization can omit a modifier ("missing category codes" -> "codes"),
  // but a rewrite cannot introduce a new object such as customers or sales.
  return target.metric.length > 0 && source.metric.length > 0 && target.metric.every(token=>source.metric.includes(token));
}

export function checkNumericEvidence(text: string, sources: readonly NumericSource[]): string[] {
  const target=claims(text);
  const evidence=sources.flatMap(source=>claims(source.text,source.basis ?? "",source.team).map(claim=>({ ...claim, sourceId:source.id })));
  const issues: string[]=[];
  for (const claim of target) {
    const sameValue=evidence.filter(source=>source.value === claim.value);
    const prefix=`数字 ${claim.label}`;
    if (!sameValue.length) { issues.push(`${prefix} 不在所引用的已确认事实中`); continue; }
    const sameUnit=sameValue.filter(source=>source.unit === claim.unit);
    if (!sameUnit.length) { issues.push(`${prefix} 的单位与来源不一致，不能将数量、百分比、百分点、金额或时长互换`); continue; }
    const sameMetric=sameUnit.filter(source=>metricMatches(source,claim) || normalize(source.clause) === normalize(claim.clause));
    if (!sameMetric.length) { issues.push(`${prefix} 无法对应到来源中的同一指标或对象，请保留来源的指标名称`); continue; }
    const sameMeaning=sameMetric.filter(source=>source.direction === claim.direction && source.relation === claim.relation);
    if (!sameMeaning.length) { issues.push(`${prefix} 的变化方向或比较口径与来源不一致，不能把现有水平改成增长量`); continue; }
    const sameOwner=sameMeaning.filter(source=>!source.team || claim.team);
    if (!sameOwner.length) { issues.push(`${prefix} 来自团队成果，不能改写成个人独立完成的数量或业绩`); continue; }
    const sameLimits=sameOwner.filter(source=>[...source.restrictions].every(restriction=>claim.restrictions.has(restriction)));
    if (!sameLimits.length) {
      const limits=[...new Set(sameOwner.flatMap(source=>[...source.restrictions].filter(r=>!claim.restrictions.has(r))))];
      issues.push(`${prefix} 未保留来源限制：${limits.join("、")}；请保留限制说明后再审阅`);
      continue;
    }
    const targetContext=new Set([...metricTokens(claim.clause), ...[...claim.clause.matchAll(NUMBER)].map(match=>String(numberValue(match[0])))]);
    if (!sameLimits.some(source=>source.baseline.every(token=>targetContext.has(token)))) issues.push(`${prefix} 未保留来源的比较基准或统计口径，请保留原口径后再审阅`);
  }
  return [...new Set(issues)];
}
