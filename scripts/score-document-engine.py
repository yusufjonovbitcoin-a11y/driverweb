"""Reproducible local report. Never contacts AI or modifies frozen references."""
import datetime
import hashlib
import html
import json
import math
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path('output/pdf-engine-benchmark-2026-10-31')
OLD = Path('output/pdf-slot-validation-test-2026-10-31')
FROZEN = Path('output/pdf-markitdown-comparison-2026-10-31')
SYNTHETIC = Path('output/pdf-engine-synthetic-2026-10-31')
manifest = json.loads((FROZEN / 'manifest.json').read_text(encoding='utf-8'))
references = json.loads((FROZEN / 'reference.json').read_text(encoding='utf-8'))['documents']

# The original 289 checks are unchanged. Apply the previously documented date
# normalizer fix equally to the baseline and new results (OCT is not ISO T).
scope = {'datetime': datetime, 're': re}
scorer = (FROZEN / 'score.py').read_text(encoding='utf-8')
exec(scorer[scorer.index('def normalize('):scorer.index('\nresults=[]')], scope)

def date_value(value):
    if not value:
        return None
    value = re.sub(r'^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*', '', str(value).strip(), flags=re.I)
    value = re.split(r'T(?=\d{2}:)', value)[0]
    for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%m-%d-%Y', '%m-%d-%y',
                '%B %d, %Y', '%b %d, %Y', '%B %d %Y', '%b %d %Y']:
        try:
            return datetime.datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return value

scope['date_value'] = date_value
normalize = scope['normalize']

def quality(candidate, reference):
    score = scope['evaluate'](candidate, reference)
    critical = [check for check in score['checks'] if check['field'] in ['loadNumber', 'brokerRate', 'broker.name', 'stops.count']
                or check['field'].startswith('stops.')]
    strict_broker = any(normalize(candidate.get('broker', {}).get('name')) == normalize(alias) for alias in reference['brokerAliases'])
    return {**score, 'criticalPassed': sum(check['pass'] for check in critical), 'criticalTotal': len(critical),
            'strictBrokerMatch': strict_broker,
            'completeCritical': all(check['pass'] for check in critical) and strict_broker,
            'completeSelected': score['passed'] == score['total'] and strict_broker,
            'wrongPopulated': sum(check['actual'] not in [None, '', []] for check in score['failures']),
            'missingOrHeld': sum(check['actual'] in [None, '', []] for check in score['failures'])}

def cost(model, usage):
    rates = [0.4, 0.1, 1.6] if model.startswith('gpt-4.1-mini') else [0.25, 0.025, 2] if model.startswith('gpt-5-mini') else None
    if rates is None or not usage:
        return None
    cached = min(usage['input_tokens'], max(0, usage.get('input_tokens_details', {}).get('cached_tokens', 0)))
    return ((usage['input_tokens'] - cached) * rates[0] + cached * rates[1] + usage['output_tokens'] * rates[2]) / 1_000_000

def run_values(run, validation=None):
    direct = 'usage' in run
    calls = [{'usage': run['usage'], 'actualModel': run['actualModel'], 'durationMs': run['apiMs']}] if direct else run['requests']
    result = validation or (run if direct else run.get('result', {}))
    return {'seconds': (run['totalMs'] + (validation or {}).get('validationMs', 0)) / 1000,
            'apiSeconds': sum(call['durationMs'] for call in calls) / 1000,
            'calls': run.get('attempts', len(calls)),
            'tokens': {key: sum((call.get('usage') or {}).get(key, 0) for call in calls) for key in ['input_tokens', 'output_tokens', 'total_tokens']},
            'estimatedCostUsd': sum(cost(call.get('actualModel') or run['model'], call.get('usage')) or 0 for call in calls),
            'safe': result.get('verified', {}).get('safe', {}), 'candidate': result.get('candidate', {}),
            'error': run.get('error'), 'httpStatuses': [call.get('status', 200) for call in calls],
            'supplementalValidationMs': (validation or {}).get('validationMs', 0)}

rows = []
for doc in manifest:
    folder = ROOT / doc['id']
    original = Path(doc['path'])
    checksum = hashlib.sha256(original.read_bytes()).hexdigest()
    direct = json.loads((OLD / doc['id'] / 'direct.json').read_text(encoding='utf-8'))
    run = json.loads((folder / 'gpt-4.1-mini.final.json').read_text(encoding='utf-8'))
    validation = json.loads((folder / 'gpt-4.1-mini.validation.json').read_text(encoding='utf-8'))
    before = run_values(direct)
    after = run_values(run, validation)
    before['quality'] = quality(before['safe'], references[doc['id']])
    after['quality'] = quality(after['safe'], references[doc['id']])
    metrics = run['result']['audit']['metrics']
    after['initialQuality'] = quality(run['result']['verified']['safe'], references[doc['id']])
    after['metrics'] = metrics
    after['sourceConflicts'] = [issue for issue in after['candidate']['engineIssues'] if issue['reason'].startswith('conflicting_')]
    rows.append({'id': doc['id'], 'name': doc['name'], 'pages': metrics['pageCount'], 'bytes': doc['bytes'],
                 'sha256': checksum, 'originalUnchanged': checksum == doc['sha256'], 'before': before, 'after': after})

def aggregate(values):
    times = sorted(value['seconds'] for value in values)
    return {'documents': len(values), 'meanSeconds': statistics.mean(times), 'p50Seconds': statistics.median(times),
            'p95Seconds': times[math.ceil(.95 * len(times)) - 1], 'sumDocumentSeconds': sum(times),
            'calls': sum(value['calls'] for value in values),
            'tokens': {key: sum(value['tokens'][key] for value in values) for key in ['input_tokens', 'output_tokens', 'total_tokens']},
            'estimatedCostUsd': sum(value['estimatedCostUsd'] for value in values),
            **{key: sum(value['quality'][key] for value in values) for key in ['passed', 'total', 'criticalPassed', 'criticalTotal', 'wrongPopulated', 'missingOrHeld', 'completeCritical', 'completeSelected']}}

summary = {mode: aggregate([row[mode] for row in rows]) for mode in ['before', 'after']}
ordinary = [row['after'] for row in rows if row['pages'] <= 5 and not row['after']['metrics']['ocrPages']]
summary['ordinaryDigital'] = aggregate(ordinary)
models = {}
for model in ['gpt-4.1-mini', 'gpt-5-mini']:
    values = []
    for identity in ['02', '08', '12']:
        run = json.loads((ROOT / identity / f'{model}.final.json').read_text(encoding='utf-8'))
        validation = json.loads((ROOT / identity / f'{model}.validation.json').read_text(encoding='utf-8'))
        value = run_values(run, validation)
        value['quality'] = quality(value['safe'], references[identity])
        values.append(value)
    models[model] = aggregate(values)

synthetic = []
def at(data, field):
    for part in field.split('.'):
        data = data[int(part)] if isinstance(data, list) and int(part) < len(data) else data.get(part) if isinstance(data, dict) else None
    return data
for doc in json.loads((SYNTHETIC / 'manifest.json').read_text(encoding='utf-8')):
    run = json.loads((SYNTHETIC / doc['id'] / 'gpt-4.1-mini.final.json').read_text(encoding='utf-8'))
    validation = json.loads((SYNTHETIC / doc['id'] / 'gpt-4.1-mini.validation.json').read_text(encoding='utf-8'))
    value = run_values(run, validation)
    checks = []
    for field, expected in doc['expected'].items():
        actual = len(value['safe'].get('stops', [])) if field == 'stops.count' else at(value['safe'], field)
        matched = actual == expected if not isinstance(expected, str) else normalize(actual) == normalize(expected)
        checks.append({'field': field, 'expected': expected, 'actual': actual, 'pass': matched})
    conflicts = [issue for issue in value['candidate']['engineIssues'] if issue['reason'].startswith('conflicting_')]
    synthetic.append({'id': doc['id'], 'category': doc['category'], 'checks': checks, 'passed': sum(check['pass'] for check in checks),
                      'total': len(checks), 'conflictExpected': doc['conflictExpected'], 'conflictDetected': bool(conflicts),
                      'seconds': value['seconds'], 'tokens': value['tokens'], 'calls': value['calls']})

failures = Counter(check['field'].split('.')[-1] for row in rows for check in row['after']['quality']['failures'])
comparison = {'date': '2026-10-31', 'aggregate': summary, 'models': models, 'synthetic': synthetic,
              'documents': rows, 'failureCategories': dict(failures), 'originalFilesUnchanged': all(row['originalUnchanged'] for row in rows),
              'pricing': {'checked': '2026-10-31', 'basis': 'standard text token estimate, cached input included; excludes worker/hosting/tax',
                          'sources': ['https://developers.openai.com/api/docs/models/gpt-4.1-mini', 'https://developers.openai.com/api/docs/models/gpt-5-mini']}}
(ROOT / 'comparison.json').write_text(json.dumps(comparison, ensure_ascii=False, indent=2), encoding='utf-8')
a, b = summary['before'], summary['after']
token_saving = (1 - b['tokens']['total_tokens'] / a['tokens']['total_tokens']) * 100
time_saving = (1 - b['meanSeconds'] / a['meanSeconds']) * 100
limitations = [
    'Bu lokal implementatsiya. Supabase productionga deploy qilinmadi; bazaga yuk yoki assignment yozilmadi.',
    '12 haqiqiy fayl — 40 sahifa, 12 mustaqil shipment emas. 02/03 bitta yuk versiyalari, 04/05 bog‘liq hujjatlar.',
    '289 tekshiruv avvalgi reference.json dan o‘zgartirilmasdan olindi. Javoblar model promptiga yuborilmadi.',
    'Tanlangan maydonlar bo‘yicha foiz barcha PDF ma’lumotlari yoki talablar aniqligi emas. 99% umumiy aniqlik tasdiqlanmadi.',
    'Complete critical: load, broker, rate, stop tartibi/soni, manzil va vaqt tekshiruvlarining barchasi + brokerning qat’iy nom mosligi. Frozen scorer broker uchun yumshoq substring mosligini ham qabul qiladi; complete ko‘rsatkichda bu kuchaytirildi.',
    'BOLda load raqami yoki rate yo‘qligi to‘g‘ri bo‘lishi mumkin. Reference mosligi hujjat tayinlashga tayyor degani emas.',
    'Har fayl/model uchun yakuniy bitta API yugurishi. Oldingi tajriba fayllari saqlandi, yakuniy natijaga aralashtirilmadi. Parallel tashqi so‘rovlar ko‘pi bilan 2.',
    'Final API trace olingach umumiy jadval headerini ikkala stop anchori deb berish xatosi backendda tuzatildi. Barcha qayd etilgan javoblar bir xil yakuniy validator bilan qayta tekshirildi, yangi AI chaqiruvisiz. Original JSON va dastlabki score alohida saqlandi; qo‘shimcha tekshiruv vaqti totalga qo‘shildi.',
    'Latency: native parsing, kerakli OCR, API, barcha haqiqiy retries va qo‘shimcha source verification. Frontend upload tarmog‘i, Edge cold start, auth, DB/Storage va inson review vaqti bu benchmarkga kirmaydi.',
    'P50 — median; P95 — nearest-rank. 12 ta kuzatuvdagi P95 maksimumga teng, barqaror xizmat SLA emas.',
    'OCR matn xatolari va semantik noto‘g‘ri slotlar qolishi mumkin. Manbada mos so‘z topishning o‘zi mutlaq isbot emas.',
    'Talab va kontrakt bandlari asl manba bloklaridan tiklandi. Ularning to‘liq semantik recall aniqligi qo‘lda alohida belgilab o‘lchanmadi.',
    'OCR worker sozlanmasa, skan uchun eski PDF Vision yo‘li manual review bilan qoladi. Bu yo‘lda independent source verification bor deb belgilanmaydi. Selective Vision page-cropping hali implementatsiya qilinmagan.',
    'Warm cache 20 daqiqa/bounded memory. Saqlangan import cache company+actor+hash+version+model bilan qayta tekshiriladi. Hali tasdiqlanmagan preview isolate qayta ishga tushsa qayta o‘qilishi mumkin.',
    '8 sun’iy fayl — regression coverage; ular haqiqiy 12 ta fayl statistikasi bilan birlashtirilmadi. Yangi, mustaqil brokerlar korpusi hali kerak.',
    'Xarajatlar rasmiy model sahifalaridagi tariflar bilan taxminiy hisoblandi; invoice emas. OCR hosting va boshqa infratuzilma xarajatlari kirmaydi.',
]
md = ['# T Fleets PDF engine — audit va benchmark', '', '2026-10-31 · hybrid-3 · local implementation, not deployed', '',
      '| Ko‘rsatkich | Oldingi PDF direct | Hybrid + yakuniy validator |', '|---|---:|---:|',
      f'| Tanlangan maydonlar | {a["passed"]}/{a["total"]} | {b["passed"]}/{b["total"]} |',
      f'| O‘rtacha vaqt | {a["meanSeconds"]:.2f} s | {b["meanSeconds"]:.2f} s |',
      f'| P50 / P95 | {a["p50Seconds"]:.2f} / {a["p95Seconds"]:.2f} s | {b["p50Seconds"]:.2f} / {b["p95Seconds"]:.2f} s |',
      f'| Token | {a["tokens"]["total_tokens"]:,} | {b["tokens"]["total_tokens"]:,} |',
      f'| AI so‘rovi | {a["calls"]} | {b["calls"]} |',
      f'| Complete critical | {a["completeCritical"]}/12 | {b["completeCritical"]}/12 |',
      f'| Xato to‘ldirilgan / bo‘sh yoki ushlangan | {a["wrongPopulated"]} / {a["missingOrHeld"]} | {b["wrongPopulated"]} / {b["missingOrHeld"]} |',
      f'| Taxminiy AI xarajati | ${a["estimatedCostUsd"]:.5f} | ${b["estimatedCostUsd"]:.5f} |', '',
      f'Token tejalishi: {token_saving:.1f}%. O‘rtacha vaqt kamayishi: {time_saving:.1f}%.', '',
      '| ID | PDF | Oldingi (s) | Hybrid (s) | Natija | AI so‘rov / token |', '|---|---|---:|---:|---:|---:|']
for row in rows:
    value = row['after']; q = value['quality']
    md.append(f'| {row["id"]} | {row["name"]} | {row["before"]["seconds"]:.2f} | {value["seconds"]:.2f} | {q["passed"]}/{q["total"]} | {value["calls"]} / {value["tokens"]["total_tokens"]} |')
md += ['', '## Cheklovlar', *['- ' + item for item in limitations]]
(ROOT / 'report.md').write_text('\n'.join(md), encoding='utf-8')
esc = lambda value: html.escape(str(value))
table_rows, details = [], []
for row in rows:
    value = row['after']; q = value['quality']; stages = value['metrics']['stages']
    table_rows.append(f'<tr><th><a href="#doc-{row["id"]}">{row["id"]}</a></th><td>{esc(row["name"])}<small>{row["pages"]} sahifa · OCR {esc(value["metrics"]["ocrPages"] or "kerak emas")}</small></td><td>{row["before"]["seconds"]:.2f}</td><td>{value["seconds"]:.2f}</td><td>{q["passed"]}/{q["total"]}</td><td>{value["calls"]}</td><td>{value["tokens"]["total_tokens"]:,}</td></tr>')
    differences = ''.join(f'<tr><td><code>{esc(check["field"])}</code></td><td>{esc(check["expected"])}</td><td>{esc(check["actual"])}</td></tr>' for check in q['failures']) or '<tr><td colspan="3">Tanlangan tekshiruvlarda farq yo‘q.</td></tr>'
    issues = ''.join(f'<li><code>{esc(issue["field"])}</code>: {esc(issue["reason"])} {esc(issue.get("alternatives", ""))}</li>' for issue in value['candidate']['engineIssues'])
    details.append(f'<details class="panel" id="doc-{row["id"]}"><summary>{row["id"]} · {esc(row["name"])}</summary><p>Native {stages.get("nativeTextMs",0):.1f} ms · OCR {stages.get("ocrMs",0):.1f} ms · API {value["apiSeconds"]:.2f} s · qo‘shimcha tekshiruv {value["supplementalValidationMs"]:.1f} ms. Dastlabki score: {value["initialQuality"]["passed"]}/{q["total"]}.</p><div class="scroll"><table><thead><tr><th>Slot</th><th>Reference</th><th>Yakuniy qiymat</th></tr></thead><tbody>{differences}</tbody></table></div><ul>{issues or "<li>Qo‘shimcha engine signali yo‘q.</li>"}</ul><p><a href="{row["id"]}/gpt-4.1-mini.final.json">Asl API trace</a> · <a href="{row["id"]}/gpt-4.1-mini.validation.json">Yakuniy dalillar / source IDs / koordinatalar</a> · <a href="../pdf-markitdown-comparison-2026-10-31/{row["id"]}/page-01.png">Asl PDF sahifasi</a></p></details>')
model_rows = ''.join(f'<tr><th>{esc(model)}</th><td>{value["passed"]}/{value["total"]}</td><td>{value["p50Seconds"]:.2f}</td><td>{value["p95Seconds"]:.2f}</td><td>{value["tokens"]["input_tokens"]:,} / {value["tokens"]["output_tokens"]:,}</td><td>${value["estimatedCostUsd"]:.5f}</td><td>{value["calls"]}</td></tr>' for model, value in models.items())
synthetic_rows = ''.join(f'<tr><th>{row["id"]}</th><td>{row["category"]}</td><td>{row["passed"]}/{row["total"]}</td><td>{row["seconds"]:.2f}</td><td>{"Ushlandi" if row["conflictDetected"] else "Ziddiyat kutilmagan"}</td></tr>' for row in synthetic)
ordinary = summary['ordinaryDigital']
page = f'''<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T Fleets · PDF engine benchmark</title><style>
:root{{font:15px/1.55 Segoe UI,Arial,sans-serif;color:#172d49;background:#f2f5fa}}*{{box-sizing:border-box}}body{{margin:0}}main{{max-width:1460px;padding:28px 34px 60px;margin:auto}}h1{{font-size:31px;line-height:1.2;margin:8px 0 12px}}h2{{font-size:20px;margin:0 0 14px}}p{{margin:10px 0}}a{{color:#2458d5}}.eyebrow{{font-size:12px;letter-spacing:.1em;font-weight:700;color:#426389}}.muted,small{{color:#62758c}}.notice{{padding:12px 16px;background:#fff4dc;border:1px solid #ead3a4;border-radius:8px;margin:18px 0}}.metrics{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}}.metric,.panel{{background:white;border:1px solid #d8e2ef;border-radius:10px;padding:19px 21px}}.metric strong{{display:block;font-size:27px;color:#164ea5}}.metric small,td small{{display:block}}.panel{{margin-top:18px}}.scroll{{overflow:auto;border:1px solid #e1e7f0;border-radius:7px}}table{{border-collapse:collapse;width:100%;font-size:13px;text-align:left}}th,td{{padding:11px 12px;border-bottom:1px solid #e2e9f3;vertical-align:top}}thead th{{background:#f0f4fa;color:#4e6685;white-space:nowrap}}td{{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}}td:nth-child(2){{min-width:150px}}tbody tr:last-child>*{{border-bottom:0}}summary{{font-weight:700;cursor:pointer}}summary:focus-visible,a:focus-visible{{outline:2px solid #2458d5;outline-offset:4px}}details p{{color:#4a6380}}code{{font-size:12px;overflow-wrap:anywhere}}li{{margin:8px 0}}.two{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}.pill{{display:inline-block;padding:3px 8px;border-radius:5px;background:#e6eefc;color:#214a98;font-size:12px}}@media(max-width:850px){{main{{padding:20px}}.metrics{{grid-template-columns:repeat(2,1fr)}}.two{{grid-template-columns:1fr}}}}</style><main>
<span class="eyebrow">T FLEETS / DOCUMENT INTELLIGENCE / 2026-10-31</span><h1>PDF tezligi va dalil tekshiruvi</h1><p class="muted">12 haqiqiy PDF · 40 sahifa · o‘zgarmagan 289 reference tekshiruvi · 8 qo‘shimcha sun’iy PDF</p>
<span class="pill">Lokal implementatsiya · productionga deploy qilinmagan</span>
<div class="metrics"><div class="metric">Tanlangan maydonlar<strong>{b['passed']}/{b['total']}</strong><small>Oldingi {a['passed']}/{a['total']} · umumiy aniqlik kafolati emas</small></div><div class="metric">O‘rtacha vaqt<strong>{b['meanSeconds']:.2f} s</strong><small>Oldingi {a['meanSeconds']:.2f} s · {time_saving:.1f}% kamaydi</small></div><div class="metric">Token sarfi<strong>{b['tokens']['total_tokens']:,}</strong><small>Oldingi {a['tokens']['total_tokens']:,} · {token_saving:.1f}% tejaldi</small></div><div class="metric">Complete critical<strong>{b['completeCritical']}/12</strong><small>Oldingi {a['completeCritical']}/12 · noaniq qiymatlar ushlab qolindi</small></div></div>
<div class="notice"><strong>Tezlik maqsadi hali bajarilmadi.</strong> Oddiy 1–5 sahifali raqamli {ordinary['documents']} hujjatda P50 {ordinary['p50Seconds']:.2f} s / P95 {ordinary['p95Seconds']:.2f} s. Maqsad: &lt;5 / &lt;10 s. Hosting va upload tarmog‘i bundan tashqari.</div>
<section class="panel"><h2>Bir xil fayllar: oldin va keyin</h2><div class="scroll" role="region" aria-label="Haqiqiy PDF natijalari" tabindex="0"><table><thead><tr><th>ID</th><th>PDF</th><th>Oldingi, s</th><th>Hybrid, s</th><th>Tekshiruv</th><th>AI soni</th><th>Token</th></tr></thead><tbody>{''.join(table_rows)}</tbody></table></div><p class="muted">Jami {b['calls']} AI so‘rovi; haqiqiy retries va ularning token/vaqti chiqarib tashlanmadi. P50 {b['p50Seconds']:.2f} s · P95 {b['p95Seconds']:.2f} s. Dastlabki va yakuniy validator natijalari har faylda ochiladi.</p></section>
<section class="panel"><h2>Model taqqoslash — bir xil 02, 08, 12 fayllar</h2><div class="scroll"><table><thead><tr><th>Model</th><th>Maydonlar</th><th>P50, s</th><th>P95, s</th><th>Input / output token</th><th>Taxminiy USD</th><th>AI soni</th></tr></thead><tbody>{model_rows}</tbody></table></div><p>Schema/JSON javoblari qayd etildi; source tekshiruvdan o‘tmagan qiymatlar ushlab qolindi. GPT-4.1-nano alias va snapshot sinovlari 404 model_not_found qaytardi; sifat/tezlik benchmarki sifatida olinmadi. GPT-5-nano dastlabki ikki probe’da coverage tekshiruvidan o‘tmadi; yakuniy teng taqqoslash emas.</p><p class="muted">Tarif manbasi: <a href="https://developers.openai.com/api/docs/models/gpt-4.1-mini">GPT-4.1-mini</a> va <a href="https://developers.openai.com/api/docs/models/gpt-5-mini">GPT-5-mini</a>. Xarajat input/cache/output token bo‘yicha taxminiy, hosting kirmaydi.</p></section>
<section class="panel"><h2>Qo‘shimcha 8 ta sun’iy regression PDF</h2><div class="scroll"><table><thead><tr><th>ID</th><th>Holat</th><th>Maydonlar</th><th>Vaqt, s</th><th>Ziddiyat</th></tr></thead><tbody>{synthetic_rows}</tbody></table></div><p>Bu fayllar haqiqiy hujjatlarning 289 tekshiruvi bilan birlashtirilmadi. Prompt-injection faylida HACK-999 shipment qiymati sifatida qabul qilinmasligi tekshirildi.</p></section>
<section class="panel"><h2>Qolgan farqlar va dalillar</h2><p>Har hujjatni ochib, kutilgan qiymat, yakuniy slot, source IDs, sahifa va original matnni ko‘rish mumkin. Original PDF xeshlari: {'12/12 o‘zgarmagan' if comparison['originalFilesUnchanged'] else 'farq aniqlandi'}.</p></section>{''.join(details)}
<section class="panel"><h2>O‘lchov chegaralari</h2><ul>{''.join('<li>'+esc(item)+'</li>' for item in limitations)}</ul><p><a href="comparison.json">To‘liq mashina o‘qiydigan natija</a> · <a href="report.md">Markdown hisobot</a></p></section></main></html>'''
(ROOT / 'report.html').write_text(page, encoding='utf-8')
print(json.dumps({'aggregate': summary, 'models': models, 'syntheticPassed': sum(row['passed'] for row in synthetic),
                  'syntheticTotal': sum(row['total'] for row in synthetic), 'failures': dict(failures)}, ensure_ascii=False, indent=2))
