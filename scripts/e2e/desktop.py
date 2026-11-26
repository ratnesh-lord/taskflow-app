"""
Every screen at desktop width (1440 x 900), on an account with ordinary data,
for checking the layout by eye. Screenshots go to E2E_SHOTS/desktop-*.png.
    E2E_SCRIPT=desktop.py bash scripts/e2e/run.sh
Asserts only what can be measured: nothing wider than the window, no
rounded corners.
"""
import os
import subprocess

from playwright.sync_api import expect, sync_playwright

WEB = os.environ["E2E_WEB"]
DB = os.environ["E2E_DB"]
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/taskflow-e2e")
os.makedirs(SHOTS, exist_ok=True)


def db(sql):
    return subprocess.run(["psql", "-qAt", "-d", DB, "-c", sql], capture_output=True, text=True, check=True).stdout.strip()


u = db("select test.new_user('desk@example.com', 'Desk Top')")
db(f"""
insert into public.projects (id, user_id, name, color, sort_order) values
  (gen_random_uuid(), '{u}', 'Home', 'green', 1), (gen_random_uuid(), '{u}', 'Work', 'blue', 2), (gen_random_uuid(), '{u}', 'Health', 'red', 3);
insert into public.goals (id, user_id, title, target_date) values (gen_random_uuid(), '{u}', 'Run a half marathon', current_date + 90);
insert into public.tasks (id, user_id, title, status, priority, due_date, due_time, estimated_minutes, project_id, goal_id, completed_at, sort_order)
  select gen_random_uuid(), '{u}',
         (array['Pay electricity bill','Call the bank','Write the quarterly report','Book a dentist appointment','Buy running shoes',
                'Plan the weekend trip','Renew passport','Review pull requests','Water the plants','Prepare slides'])[1 + g % 10] || case when g > 10 then ' ' || g else '' end,
         case when g > 26 then 'completed' when g % 7 = 0 then 'inbox' else 'not_started' end::public.task_status,
         (array['critical','high','medium','low'])[1 + g % 4]::public.task_priority,
         case when g % 7 <> 0 then current_date + (g % 9) - 3 end,
         case when g % 3 = 0 then make_time(9 + g % 9, 30, 0) end,
         case when g % 2 = 0 then 30 end,
         (select id from public.projects where user_id = '{u}' order by sort_order offset (g % 3) limit 1),
         case when g % 5 = 0 then (select id from public.goals where user_id = '{u}' limit 1) end,
         case when g > 26 then now() - make_interval(days => g % 6) end,
         g
  from generate_series(1, 34) g;
insert into public.habits (id, user_id, title, icon, target, unit, schedule) values
  (gen_random_uuid(), '{u}', 'Drink water', 'e:💧', 8, 'glasses', 'daily'), (gen_random_uuid(), '{u}', 'Run', 'e:🏃', 1, '', 'week:3');
insert into public.habit_logs (id, user_id, habit_id, log_date, amount)
  select gen_random_uuid(), '{u}', h.id, current_date - d, 1 + (d % 8) from public.habits h, generate_series(0, 12) d where h.user_id = '{u}' and (h.title = 'Drink water' or d % 2 = 0);
insert into public.focus_sessions (id, user_id, kind, started_at, planned_minutes)
  select gen_random_uuid(), '{u}', 'focus', now() - make_interval(days => d, hours => 2), 25 from generate_series(0, 10) d;
""")

ROUNDED = """() => [...document.querySelectorAll('*')].filter((el) => {
  const s = getComputedStyle(el);
  return ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].some((k) => s[k] !== '0px');
}).length"""
WIDE = "() => document.documentElement.scrollWidth - window.innerWidth"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Kolkata")
    page.goto(WEB + "/")
    page.get_by_label("Email").fill("desk@example.com")
    page.get_by_label("Password").fill("correct-password")
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("heading", name="Today", exact=True).last).to_be_visible(timeout=30000)
    expect(page.get_by_text("Pay electricity bill", exact=False).first).to_be_attached(timeout=30000)
    page.wait_for_timeout(1500)
    routes = ["/", "/inbox", "/upcoming", "/projects", "/more", "/search", "/completed", "/all-tasks", "/categories", "/colours",
              "/widgets", "/plan", "/review", "/analytics", "/matrix", "/goals", "/habits", "/focus", "/notes", "/google", "/reminders"]
    problems = []
    tabs = [page.get_by_role("tab", name=n).first.bounding_box() for n in ["Today", "Inbox", "More"]]
    if not (all(t["x"] < 300 for t in tabs) and tabs[0]["y"] < tabs[1]["y"] < tabs[2]["y"] and tabs[1]["y"] - tabs[0]["y"] < 80):
        problems.append(f"the tabs are not a sidebar on the left: {tabs}")
    for r in routes:
        page.goto(WEB + r)
        page.wait_for_timeout(1200)
        name = r.strip("/") or "today"
        page.screenshot(path=f"{SHOTS}/desktop-{name}.png")
        over = page.evaluate(WIDE)
        if over > 0:
            problems.append(f"{r} is {over}px wider than the window")
        if page.evaluate(ROUNDED):
            problems.append(f"{r} has rounded corners")
        print(f"shot {r}")
    browser.close()
print("problems: " + ("; ".join(problems) if problems else "none"))
raise SystemExit(1 if problems else 0)
