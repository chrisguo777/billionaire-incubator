"""Run fixed resume evaluation cases against the local Demo (9 paid calls by default).
Usage: python3 tests/evaluation/run.py --output /absolute/output/directory
No personal CVs or API keys are loaded by this runner.
"""
import argparse, concurrent.futures, datetime, hashlib, json, pathlib, time, urllib.request, urllib.error

DIMENSIONS = {'relevance':'岗位匹配','contribution':'个人贡献','methods':'方法与工具','outcomes':'成果与证据','clarity':'表达清晰度','faithfulness':'事实一致性'}

def fixture(case_id, original, rewritten, action, outcome):
    card={'id':'c1','affiliation_id':'a1','name':'Reporting project','my_role':None,**{f:[] for f in ['context','my_actions','team_actions','methods','tools','skills','scale']},'outcomes':[]}
    card['original_bullets']=[{'id':'cvb1','text':original}]
    card['my_actions']=[{'id':'f1','text':action,'status':'user_confirmed','source':'cv_parse'}]
    card['outcomes']=[{'id':'o1','note':outcome,'value':None,'unit':None,'basis':None,'status':'user_confirmed','source':'cv_parse'}]
    body={'step':'evaluate','cv':original,'db':{'affiliations':[{'id':'a1','organization':'Example Company','title':'Analyst Intern','type':'intern','start_date':None,'end_date':None}],'cards':[card]},'jd':{'role_title':'Data Analyst','domain':'Analytics','seniority':'Entry','requirements':[{'id':'r1','text':'Build Python reports to help operations teams make decisions','kind':'responsibility','priority':'high','keywords':['python','reporting','operations']}]},'gaps':[],'rewritten':[{'card_id':'c1','bullets':[{'original_bullet_id':'cvb1','text':rewritten,'source_ids':['f1','o1'],'ok':True,'issues':[]}]}],'choices':{'c1:cvb1':{'text':rewritten,'status':'accepted'}}}
    return {'id':case_id,'body':body}

CASES=[
 fixture('faithful','Used Python to build a weekly operations report. The report helped the operations team review payment failures.','Built a weekly operations report using Python to help the operations team review payment failures.','Used Python to build a weekly operations report.','The report helped the operations team review payment failures.'),
 fixture('overclaim','Supported a team by cleaning data in Python for a weekly report. The team delivered an operations report.','Led the reporting team and designed a Snowflake data platform that delivered the operations report.','Supported a team by cleaning data in Python for a weekly report.','The team delivered an operations report.'),
 fixture('qualitative','Wrote a Python guide explaining how to investigate payment failures. The operations team used the guide to train new analysts.','Authored a Python troubleshooting guide for payment failures, used by the operations team to train new analysts.','Wrote a Python guide explaining how to investigate payment failures.','The operations team used the guide to train new analysts.'),
]

def call(base, case, iteration, output):
    start=time.monotonic();record={'case':case['id'],'iteration':iteration,'input':case['body']}
    request=urllib.request.Request(base+'/api/step',data=json.dumps(case['body']).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=180) as response: record['response']=json.load(response)
        report=record['response'].get('evaluation',{})
        if report.get('mode')!='live': record['error']='Expected LIVE; mock output does not measure model stability'
    except urllib.error.HTTPError as e: record['error']=f'HTTP {e.code}: '+e.read().decode()[:1000]
    except Exception as e: record['error']=str(e)
    record['elapsed_seconds']=round(time.monotonic()-start,2)
    (output/f"{case['id']}-{iteration}.json").write_text(json.dumps(record,ensure_ascii=False,indent=2))
    print(f"{case['id']} #{iteration}: {'ERROR' if 'error' in record else 'OK'} ({record['elapsed_seconds']}s)",flush=True)
    return record

def summarize(records, repeats):
    lines=['# 简历质量评估重复测试','',f'日期：{datetime.datetime.now(datetime.timezone.utc).isoformat()}','',f'固定虚构样例 {len(set(r["case"] for r in records))} 类，每类计划重复 {repeats} 次。独立调用本地评估接口，无结果缓存。','', '**范围：**本轮检验重复性和预设风险行为；没有人工评分基准，不能据此认定评分准确或已校准。', '', '0–3 分；null 表示暂不评分。相同分数也不保证建议文字一致。','']
    summary={}
    for case in CASES:
        if not any(r["case"] == case["id"] for r in records): continue
        group=[r for r in records if r['case']==case['id']]
        valid=[r['response']['evaluation'] for r in group if 'error' not in r]
        lines += [f"## {case['id']}",'',f'成功 {len(valid)} / {len(group)} 次。','', '| 维度 | 原简历各次分数 | 当前稿各次分数 | 当前稿最大分差 |','|---|---|---|---|']
        stats={}
        for key,label in DIMENSIONS.items():
            before=[next(d for d in r['dimensions'] if d['id']==key)['before']['score'] for r in valid]
            after=[next(d for d in r['dimensions'] if d['id']==key)['after']['score'] for r in valid]
            scores=[s for s in after if s is not None]
            spread=max(scores)-min(scores) if scores else None
            stats[key]={'before':before,'after':after,'after_spread':spread,'null_switch':bool(scores) and None in after}
            lines.append(f"| {label} | {before} | {after} | {spread} |")
        risks=[len(r['fact_risks']) for r in valid]
        warnings=[len(r['warnings']) for r in valid]
        lines += ['',f'各次事实风险条数：{risks}；引用核验警告数：{warnings}。','']
        for i,r in enumerate(valid,1):
            lines += [f'第 {i} 次摘要：{r["summary"]}','']
            if r['fact_risks']: lines += ['风险：'+'；'.join(x['reason'] for x in r['fact_risks']),'']
        summary[case['id']]={'runs':len(valid),'dimensions':stats,'risks':risks,'warnings':warnings}
    errors=[r for r in records if 'error' in r]
    if errors: lines += ['## 调用失败','']+[f"- {r['case']} #{r['iteration']}: {r['error']}" for r in errors]
    lines += ['', '## 判读约定','', '- 同一维度最大分差大于 1，或数字评分与 null 来回切换，标为需要复查。', '- overclaim 应识别个人职责夸大与新增 Snowflake 工具；风险数量只能辅助观察，必须阅读实际风险理由。', '- qualitative 不应仅因没有数字就判成果完全缺失；允许指出证据强度仍可补充。', '- faithful 不应凭空报告新增职责或工具；前后措辞变化可能产生合理的小幅评分差异。', '- 这些是开发者设计的行为检查，不是团队人工评分结果；3 次重复仅能暴露明显波动。']
    return '\n'.join(lines)+'\n',summary

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:3000');parser.add_argument('--repeats',type=int,default=3);parser.add_argument('--output',required=True);parser.add_argument('--case',choices=[c['id'] for c in CASES]);parser.add_argument('--expected-version');args=parser.parse_args()
    if args.repeats<2: parser.error('至少重复两次')
    with urllib.request.urlopen(args.base+'/api/step',timeout=15) as response: server=json.load(response)
    if server.get('mode')!='live': parser.error('服务不是 LIVE，停止付费测试')
    if args.expected_version and server.get('evaluationVersion')!=args.expected_version: parser.error('评估版本不匹配；停止测试，避免调用旧代码')
    out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
    if any(out.glob('*.json')): parser.error('请使用新的输出目录，避免覆盖历史测试')
    cases=[c for c in CASES if not args.case or c['id']==args.case]
    (out/'fixtures.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2))
    project=pathlib.Path(__file__).resolve().parents[2]
    files=['lib/evaluation.ts','lib/evaluation-schema.ts','lib/llm.ts']
    (out/'version.json').write_text(json.dumps({'files':{name:hashlib.sha256((project/name).read_bytes()).hexdigest() for name in files},'base_url':args.base,'server':server,'note':'Exact provider model identifier and token usage are not captured; models are configured by the running server.'},indent=2))
    records=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(call,args.base,case,i,out) for case in cases for i in range(1,args.repeats+1)]
        for future in concurrent.futures.as_completed(futures): records.append(future.result())
    records.sort(key=lambda r:(r['case'],r['iteration']))
    report,summary=summarize(records,args.repeats)
    (out/'report.md').write_text(report);(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print('Report:',out/'report.md',flush=True)
    if any('error' in r for r in records): raise SystemExit(1)
if __name__=='__main__': main()
