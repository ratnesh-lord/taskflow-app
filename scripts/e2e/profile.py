"""
Start-up and scrolling profile of the web app with a large account, in
headless Chrome against a real database (run through scripts/e2e/run.sh):

    E2E_SCRIPT=profile.py bash scripts/e2e/run.sh

The account: 2,000 tasks (400 in the Inbox, 1,000 with dates, 600 done) and
40 daily repeats with a year of history each (about 14,600 records). Prints
how long each step took; fails only if one is far beyond its budget.
Numbers are for this machine; a mid-range phone is slower.
"""
import os
import subprocess
import time

from playwright.sync_api import expect, sync_playwright

WEB = os.environ["E2E_WEB"]
DB = os.environ["E2E_DB"]
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/taskflow-e2e")
os.makedirs(SHOTS, exist_ok=True)


def db(sql):
    return subprocess.run(["psql", "-qAt", "-d", DB, "-c", sql], capture_output=True, text=True, check=True).stdout.strip()


user = db("select test.new_user('big@example.com', 'Big Account')")
db(f"""
insert into public.projects (id, user_id, name, sort_order)
  select gen_random_uuid(), '{user}', 'Project ' || g, g from generate_series(1, 20) g;
insert into public.tasks (id, user_id, title, status, priority, due_date, due_time, completed_at, project_id, sort_order)
  select gen_random_uuid(), '{user}',
         'Task ' || g || ' with a title of an ordinary length',
         case when g <= 400 then 'inbox' when g <= 1400 then 'not_started' else 'completed' end::public.task_status,
         (array['critical','high','medium','low'])[1 + g % 4]::public.task_priority,
         case when g > 400 and g <= 1400 then current_date + (g % 120) - 60 end,
         case when g % 3 = 0 and g > 400 and g <= 1400 then make_time(8 + g % 12, 0, 0) end,
         case when g > 1400 then now() - make_interval(days => g % 60) end,
         case when g > 400 then (select id from public.projects where user_id = '{user}' order by sort_order offset (g % 20) limit 1) end,
         g
  from generate_series(1, 2000) g;
insert into public.tasks (id, user_id, title, status, due_date, rrule, sort_order)
  select gen_random_uuid(), '{user}', 'Daily habit task ' || g, 'not_started', current_date - 365, 'FREQ=DAILY', 3000 + g
  from generate_series(1, 40) g;
insert into public.task_occurrences (id, user_id, task_id, occurrence_date, status, completed_at)
  select gen_random_uuid(), '{user}', t.id, d::date, 'completed', d + interval '9 hours'
  from public.tasks t, generate_series(current_date - 365, current_date - 1, interval '1 day') d
  where t.user_id = '{user}' and t.rrule is not null;
""")
counts = db(f"select (select count(*) from public.tasks where user_id = '{user}') || ' tasks, ' || (select count(*) from public.task_occurrences where user_id = '{user}') || ' occurrence records'")
print(f"account: {counts}")

results = []


def record(name, seconds, budget):
    results.append((name, seconds, budget))
    print(f"{name:<48} {seconds * 1000:8.0f} ms   (budget {budget * 1000:.0f})")


SCROLL = """async () => {
  const lists = [...document.querySelectorAll('div')].filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 200 && el.offsetParent !== null;
  });
  const el = lists.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!el) return null;
  const frames = [];
  let last = performance.now();
  for (let i = 0; i < 120; i++) {
    el.scrollTop += 240;
    await new Promise((r) => requestAnimationFrame(r));
    const t = performance.now();
    frames.push(t - last);
    last = t;
  }
  frames.sort((a, b) => a - b);
  return { height: el.scrollHeight, p50: frames[60], p95: frames[114], max: frames[119], long: frames.filter((f) => f > 50).length };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 412, "height": 915}, timezone_id="Asia/Kolkata")
    page.goto(WEB + "/")
    page.get_by_label("Email").fill("big@example.com")
    page.get_by_label("Password").fill("correct-password")
    timing = bool(os.environ.get("E2E_SQL_TIMING"))
    start = time.monotonic()
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("heading", name="Today", exact=True).last).to_be_visible(timeout=60000)
    record("sign in until Today shows", time.monotonic() - start, 10)
    expect(page.get_by_text("Daily habit task 1", exact=True).first).to_be_visible(timeout=120000)
    record("... until the first tasks have arrived", time.monotonic() - start, 30)
    if timing:
        # Wait for the database to fall quiet: the whole account has arrived.
        page.evaluate("() => { globalThis.__taskflowSql = []; }")
        quiet_since = time.monotonic()
        seen = 0
        while time.monotonic() - quiet_since < 2.0:
            page.wait_for_timeout(250)
            n = page.evaluate("() => globalThis.__taskflowSql.length")
            if n != seen:
                seen, quiet_since = n, time.monotonic()
        record("... until the whole account has arrived", quiet_since - start, 120)
        log = page.evaluate("() => globalThis.__taskflowSql")
        groups = {}
        for e in log:
            k = " ".join(e["sql"].split()[:4])
            n, t = groups.get(k, (0, 0))
            groups[k] = (n + 1, t + e["ms"])
        print(f"-- database during the first sync: {len(log)} statements")
        for k, (n, t) in sorted(groups.items(), key=lambda kv: -kv[1][1])[:10]:
            print(f"   {t:8.0f} ms  {n:6d} x  {k}")
        page.evaluate("() => { globalThis.__taskflowSql = undefined; }")
    page.screenshot(path=f"{SHOTS}/p1-today.png")

    start = time.monotonic()
    page.reload()
    expect(page.get_by_text("Daily habit task 1", exact=True).first).to_be_visible(timeout=60000)
    record("reload until Today's tasks show (from this browser)", time.monotonic() - start, 10)

    start = time.monotonic()
    page.get_by_role("tab", name="Inbox").click()
    expect(page.get_by_text("Task 400 with a title of an ordinary length", exact=True).first).to_be_visible(timeout=30000)
    record("open the Inbox until its first task shows", time.monotonic() - start, 3)
    expect(page.get_by_text("Task 1 with a title of an ordinary length", exact=True).first).to_be_attached(timeout=30000)
    record("... until all 400 tasks are drawn", time.monotonic() - start, 5)
    page.wait_for_timeout(500)
    s = page.evaluate(SCROLL)
    print(f"Inbox scroll: {s}")
    results.append(("Inbox scroll: frames over 50 ms", s["long"] if s else 0, 30))

    page.get_by_role("tab", name="Today").click()
    page.wait_for_timeout(2000)
    # Clicked and timed inside the page: Playwright's own role queries walk the
    # whole page, which with ~1,500 rows on screen costs more than the app does.
    TICK = """async (name) => {
      const box = document.querySelector(`[role=checkbox][aria-label="Complete: ${name}"]`);
      if (!box) return null;
      const t0 = performance.now();
      box.click();
      const done = () => document.querySelector(`[role=checkbox][aria-label="Reopen: ${name}"]`)
        || !document.querySelector(`[role=checkbox][aria-label="Complete: ${name}"]`);
      while (!done()) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    }"""
    for name in ["Task 410 with a title of an ordinary length", "Daily habit task 1"]:
        cdp = page.context.new_cdp_session(page) if os.environ.get("E2E_CPU_PROFILE") else None
        if cdp:
            cdp.send("Profiler.enable")
            cdp.send("Profiler.setSamplingInterval", {"interval": 500})
            cdp.send("Profiler.start")
        page.evaluate("() => { globalThis.__taskflowSql = []; }")
        ms = page.evaluate(TICK, name)
        page.wait_for_timeout(1500)
        sql = page.evaluate("() => { const l = globalThis.__taskflowSql || []; globalThis.__taskflowSql = undefined; return l; }")
        if sql:
            t0 = min(e["at"] for e in sql)
            total = sum(e["ms"] for e in sql)
            print(f"-- database while ticking {name}: {len(sql)} statements, {total:.0f} ms in all")
            for e in sorted(sql, key=lambda e: -e["ms"])[:12]:
                print(f"   {e['ms']:7.1f} ms  at +{e['at'] - t0:6.0f}  {e['sql']}")
        if cdp:
            prof = cdp.send("Profiler.stop")["profile"]
            by_id = {n["id"]: n for n in prof["nodes"]}
            dt = {}
            for sid, delta in zip(prof["samples"], prof["timeDeltas"]):
                fr = by_id[sid]["callFrame"]
                key = f'{fr["functionName"] or "(anonymous)"} {fr["url"].rsplit("/", 1)[-1][:30]}:{fr["lineNumber"]}'
                dt[key] = dt.get(key, 0) + delta / 1000
            print(f"-- CPU self time while ticking {name}:")
            for k, v in sorted(dt.items(), key=lambda kv: -kv[1])[:25]:
                print(f"   {v:8.1f} ms  {k}")
        if ms is None:
            print(f"(no checkbox for {name} on Today)")
            continue
        kind = "a repeating task" if name.startswith("Daily") else "a one-off task"
        record(f"tick {kind}: until Today shows it", ms / 1000, 3)
        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(2500)
    browser.close()

over = [r for r in results if r[1] > r[2]]
print("over budget: " + (", ".join(r[0] for r in over) if over else "none"))
raise SystemExit(1 if over else 0)
