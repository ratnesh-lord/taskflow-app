"""
Web end-to-end check. Drives the exported web app in headless Chrome against
mock-supabase.mjs (fake sign-in, real Postgres) and asserts what a person would see.

Environment: E2E_WEB (address of the web app), E2E_DB (database name), E2E_SHOTS (folder for screenshots)
"""
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

WEB = os.environ["E2E_WEB"]
DB = os.environ["E2E_DB"]
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/taskflow-e2e")
EMAIL = "e2e@example.com"
os.makedirs(SHOTS, exist_ok=True)

passed = 0


def ok(message):
    global passed
    passed += 1
    print(f"ok   {message}")


def db(sql):
    return subprocess.run(["psql", "-qAt", "-d", DB, "-c", sql], capture_output=True, text=True, check=True).stdout.strip()


ROUNDED = """() => [...document.querySelectorAll('*')].filter((el) => {
  const s = getComputedStyle(el);
  return ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius']
    .some((k) => s[k] !== '0px');
}).map((el) => el.tagName.toLowerCase() + ':' + (el.textContent || '').slice(0, 30))"""


def assert_square(page, where):
    rounded = page.evaluate(ROUNDED)
    assert rounded == [], f"rounded corners on {where}: {rounded[:5]}"
    ok(f"no element on {where} has a rounded corner")


def assert_fits(page, where):
    """The page itself never grows taller than the window: long content scrolls inside the screen."""
    height = page.evaluate("() => [document.body.scrollHeight, window.innerHeight]")
    assert height[0] <= height[1], f"{where} is {height[0]}px tall in a {height[1]}px window"


def field(page, label):
    """The visible input with this label (screens left behind stay in the page, hidden)."""
    return page.get_by_label(label, exact=True).filter(visible=True).last


def button(page, name):
    return page.get_by_role("button", name=name, exact=True).filter(visible=True).last


def role(page, kind, name, **kw):
    """Visible elements with this role and name."""
    return page.get_by_role(kind, name=name, **kw).filter(visible=True)


# The colour actually painted behind the page title: the first non-transparent background
# found walking up from the element at that point.
BACKGROUND = """() => {
  let el = document.elementFromPoint(window.innerWidth / 2, 120);
  while (el) {
    const c = getComputedStyle(el).backgroundColor;
    if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    el = el.parentElement;
  }
  return 'none';
}"""


def background(page):
    return page.evaluate(BACKGROUND)


def wait_for_background(page, colour):
    page.wait_for_function(f"() => ({BACKGROUND})() === '{colour}'")


user_id = db(f"select test.new_user('{EMAIL}', 'E2E Tester')")

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(
        viewport={"width": 412, "height": 915}, device_scale_factor=2,
        timezone_id="Asia/Kolkata", locale="en-GB", color_scheme="light",
    )
    page = context.new_page()
    problems = []
    page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
    page.on("console", lambda m: problems.append(f"console error: {m.text}")
            if m.type == "error" and "Failed to load resource" not in m.text else None)

    # ---- signed out ---------------------------------------------------------
    page.goto(WEB + "/")
    expect(page.get_by_role("heading", name="TaskFlow", exact=True).last).to_be_visible()
    ok("a signed-out visitor lands on the sign-in screen")
    sign_in = button(page, "Sign in")
    expect(sign_in).to_be_disabled()
    ok("the Sign in button is off while the form is empty")
    assert_square(page, "the sign-in screen")
    page.screenshot(path=f"{SHOTS}/01-sign-in-light.png")

    page.goto(WEB + "/more")
    expect(page.get_by_role("heading", name="TaskFlow", exact=True).last).to_be_visible()
    ok("a signed-out visitor who opens /more directly is sent to sign-in")

    # ---- wrong password -----------------------------------------------------
    field(page, "Email").fill(EMAIL)
    field(page, "Password").fill("wrong-password")
    sign_in.click()
    expect(page.get_by_role("alert").last).to_contain_text("do not match an account")
    ok("a wrong password is explained in plain words")
    page.screenshot(path=f"{SHOTS}/02-sign-in-error.png")

    # ---- navigation between the sign-in screens ---------------------------------
    button(page, "Create account").click()
    expect(page.get_by_role("heading", name="Create account", exact=True).last).to_be_visible()
    field(page, "Password (at least 8 characters)").fill("short")
    expect(page.get_by_text("3 more to go.")).to_be_visible()
    ok("the sign-up screen counts down a short password")
    assert_square(page, "the sign-up screen")
    button(page, "Back to sign in").click()
    button(page, "Forgot password").click()
    expect(page.get_by_role("heading", name="Reset password", exact=True).last).to_be_visible()
    ok("the reset-password screen opens")
    button(page, "Back to sign in").click()

    # ---- sign in ----------------------------------------------------------------
    field(page, "Email").fill(EMAIL)
    field(page, "Password").fill("correct-password")
    button(page, "Sign in").click()
    expect(page.get_by_role("heading", name="Today", exact=True).last).to_be_visible()
    expect(page.get_by_text("Nothing due today. Tap + to add a task.")).to_be_visible()
    ok("the right password opens the Today screen, empty for a new account")
    assert_square(page, "the Today screen")
    page.screenshot(path=f"{SHOTS}/03-today-light.png")

    page.wait_for_function("() => true")
    for _ in range(40):
        if db(f"select count(*) from public.devices where user_id = '{user_id}' and platform = 'web'") == "1":
            break
        page.wait_for_timeout(100)
    assert db(f"select count(*) from public.devices where user_id = '{user_id}' and platform = 'web'") == "1"
    ok("signing in registers this browser as one of the user's devices")

    # ---- tabs -----------------------------------------------------------------------
    for tab, heading in [("Inbox", "Inbox"), ("Upcoming", "Upcoming"), ("Projects", "Projects")]:
        page.get_by_role("tab", name=tab).click()
        expect(page.get_by_role("heading", name=heading, exact=True).last).to_be_visible()
    ok("Inbox, Upcoming and Projects open from the tab bar")
    page.get_by_role("tab", name="More").click()
    expect(page.get_by_role("heading", name="More", exact=True).last).to_be_visible()
    expect(page.get_by_text("E2E Tester")).to_be_visible()
    expect(page.get_by_role("tab", name="More")).to_have_attribute("aria-selected", "true")
    ok("the More tab shows the account and is marked as selected")

    # ---- tasks (Phase 3): quick add, overdue, complete, undo, repeat, edit, filter -------------
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    past = today - timedelta(days=3)

    def go(tab):
        page.get_by_role("tab", name=tab).click()
        expect(page.get_by_role("heading", name=tab, exact=True).filter(visible=True)).to_be_visible()

    def quick_add(text):
        button(page, "Quick add").click()
        box = field(page, "New task")
        expect(box).to_be_visible()
        box.fill(text)

    def notice(text):
        expect(page.get_by_role("alert").filter(has_text=text).last).to_be_visible()

    go("Today")
    quick_add("Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before")
    dialog = page.get_by_role("dialog", name="Quick add")
    expect(dialog.get_by_text("Complete AWS certification revision", exact=True)).to_be_visible()
    expect(dialog.get_by_text("Tomorrow, 19:00", exact=True)).to_be_visible()
    expect(dialog.get_by_text("30 min before", exact=True)).to_be_visible()
    ok("quick add reads the brief's sentence as title, tomorrow 19:00 and a reminder 30 minutes before")
    assert_square(page, "the quick-add sheet")
    page.screenshot(path=f"{SHOTS}/10-quick-add.png")
    button(page, "Add task").click()
    notice("Added: Complete AWS certification revision")
    ok("adding shows a confirmation with Undo")

    go("Upcoming")
    aws = role(page, "button", re.compile(r"^Complete AWS certification revision, Tomorrow 19:00")).last
    expect(aws).to_be_visible()
    ok("the new task is listed under tomorrow in Upcoming")

    go("Today")
    quick_add(f"Renew passport {past.day}/{past.month}/{past.year} #admin !high")
    button(page, "Add task").click()
    passport = role(page, "button", re.compile(r"^Renew passport, .*overdue$")).last
    expect(passport).to_be_visible()
    expect(page.get_by_text(re.compile(r"^Overdue · 1$", re.I)).filter(visible=True).first).to_be_visible()
    ok("a task dated three days ago shows as overdue on Today (scenario 11)")
    role(page, "checkbox", "Complete: Renew passport").last.click()
    notice("Completed: Renew passport")
    expect(passport).to_have_count(0)
    page.get_by_role("alert").get_by_role("button", name="Undo").click()
    expect(role(page, "button", re.compile(r"^Renew passport, .*overdue$")).last).to_be_visible()
    ok("completing removes it from Overdue, and Undo brings it back")
    role(page, "checkbox", "Complete: Renew passport").last.click()
    expect(page.get_by_text(re.compile(r"^Done today · 1$", re.I)).filter(visible=True).first).to_be_visible()
    ok("a task completed today is listed under Done today")

    quick_add("Water the plants every day")
    expect(page.get_by_role("dialog", name="Quick add").get_by_text("Every day", exact=True)).to_be_visible()
    button(page, "Add task").click()
    expect(role(page, "checkbox", "Complete: Water the plants").last).to_be_visible()
    role(page, "checkbox", "Complete: Water the plants").last.click()
    notice("Done for today: Water the plants")
    expect(page.get_by_text(re.compile(r"^Done today · 2$", re.I)).filter(visible=True).first).to_be_visible()
    ok("ticking a daily task records today as done")
    go("Upcoming")
    plants = role(page, "button", re.compile(r"^Water the plants, "))
    expect(plants.first).to_be_visible()
    assert plants.count() == 7, plants.count()
    ok("its next seven days are still listed in Upcoming, so no future occurrence was lost")
    role(page, "radio", "30 days").first.click()
    expect(plants).to_have_count(30)
    assert_fits(page, "Upcoming with 30 days of repeats")
    tab = page.get_by_role("tab", name="Today").bounding_box()
    assert tab["y"] + tab["height"] <= page.viewport_size["height"], tab
    ok("with a long list the tab bar stays on screen and the list scrolls")
    role(page, "radio", "7 days").first.click()
    page.screenshot(path=f"{SHOTS}/11-upcoming.png")

    role(page, "button", re.compile(r"^Complete AWS certification revision, Tomorrow")).last.click()
    expect(field(page, "Title")).to_have_value("Complete AWS certification revision")
    expect(button(page, "Due: Tomorrow, 19:00")).to_be_visible()
    expect(button(page, "Reminders: 30 min before")).to_be_visible()
    ok("the task opens with its date, time and reminder")
    button(page, "Priority: Medium").click()
    role(page, "radio", "High").last.click()
    expect(button(page, "Priority: High")).to_be_visible()
    field(page, "Add a subtask").fill("Book the exam slot")
    field(page, "Add a subtask").press("Enter")
    expect(page.get_by_text(re.compile(r"^Subtasks · 0/1$", re.I)).filter(visible=True).first).to_be_visible()
    field(page, "Notes").fill("Focus on networking and IAM.")
    field(page, "Title").click()
    assert_square(page, "the task editor")
    assert_fits(page, "the task editor")
    page.screenshot(path=f"{SHOTS}/12-task.png", full_page=True)
    button(page, "Back").click()
    expect(page.get_by_role("heading", name="Upcoming", exact=True).last).to_be_visible()

    role(page, "button", "All tasks and filters").last.click()
    expect(page.get_by_role("heading", name="All tasks", exact=True).last).to_be_visible()
    button(page, "Filter and sort").click()
    page.get_by_role("dialog", name="Filter and sort").get_by_role("checkbox", name="High").click()
    button(page, "Show tasks").click()
    rows = role(page, "button", re.compile(r"^(Complete AWS|Water the plants|Renew passport)"))
    expect(rows).to_have_count(1)
    expect(rows.first).to_have_accessible_name(re.compile(r"^Complete AWS certification revision"))
    ok("filtering by High priority leaves only the open high-priority task")
    button(page, "Save filter").click()
    field(page, "Name").fill("Important")
    button(page, "Save").click()
    expect(role(page, "checkbox", "Important")).to_have_attribute("aria-checked", "true")
    ok("the filter can be saved under a name")
    button(page, "Back").click()

    go("Projects")
    button(page, "New project").click()
    field(page, "Name").fill("Cloud exam")
    button(page, "Create project").click()
    expect(field(page, "Project name")).to_have_value("Cloud exam")
    quick_add("Read the networking chapter")
    button(page, "Add task").click()
    expect(page.get_by_text("0 of 1 done").filter(visible=True).first).to_be_visible()
    ok("a task added from inside a project belongs to it")
    role(page, "checkbox", "Complete: Read the networking chapter").last.click()
    expect(page.get_by_text("1 of 1 done").filter(visible=True).first).to_be_visible()
    expect(page.get_by_text("100%", exact=True).filter(visible=True).first).to_be_visible()
    ok("completing it moves the project to 100%")

    page.goto(WEB + "/")  # a full page load: everything below comes from the browser's database
    expect(page.get_by_text(re.compile(r"^Done today · 3$", re.I)).filter(visible=True).first).to_be_visible()
    go("More")
    expect(page.get_by_text("1 saved filter").filter(visible=True).first).to_be_visible()
    ok("after a reload every task, completion and saved filter is still there (stored in the browser's SQLite)")
    assert page.evaluate("() => window.crossOriginIsolated") is False
    ok("that storage works on an ordinary web host, without special isolation headers")
    second = context.new_page()
    second.goto(WEB + "/")
    expect(second.get_by_role("heading", name="TaskFlow is open in another tab")).to_be_visible(timeout=15000)
    second.close()
    ok("a second tab explains that the tasks are open in the first one, instead of failing silently")
    expect(page.get_by_text(re.compile(r"changes will be sent to your account")).filter(visible=True).first).to_be_visible()
    ok("More says the changes wait on this device for syncing")

    # ---- connection check: device -> push -> pull against real Postgres ------------------
    before = db(f"select timezone from public.profiles where id = '{user_id}'")
    assert before == "UTC", before
    button(page, "Check connection").click()
    expect(page.get_by_text("Sign-in, access rules and sync all work from this device.")).to_be_visible(timeout=15000)
    ok("the connection check passes all four steps")
    # Chrome reports India's zone under its older name, Asia/Calcutta; both names are the same zone.
    stored = db(f"select timezone from public.profiles where id = '{user_id}'")
    assert stored in ("Asia/Kolkata", "Asia/Calcutta"), stored
    ok(f"the pushed edit really reached the database (profile timezone is now {stored})")
    stamp = db(f"select field_ts ->> 'timezone' from public.profiles where id = '{user_id}'")
    assert re.fullmatch(r"\d{15}:\d{5}:[0-9a-f-]{36}", stamp), stamp
    ok("the edit carries a device timestamp in the agreed format")
    assert db(f"select count(*) from public.change_history where row_id = '{user_id}' and old_values ->> 'timezone' = 'UTC'") == "1"
    ok("the previous value was written to the history")
    assert_square(page, "the More screen")
    page.screenshot(path=f"{SHOTS}/04-more-light.png", full_page=True)

    # ---- appearance: dark, and it survives a reload along with the session ---------------
    assert background(page) == "rgb(255, 255, 255)", background(page)
    page.get_by_role("radio", name="Dark").click()
    wait_for_background(page, "rgb(16, 16, 16)")
    ok("choosing Dark switches the background to #101010")
    page.screenshot(path=f"{SHOTS}/05-more-dark.png", full_page=True)
    page.reload()
    expect(page.get_by_role("heading", name="More", exact=True).last).to_be_visible()
    wait_for_background(page, "rgb(16, 16, 16)")
    ok("after a reload the user is still signed in and still in dark mode")
    page.get_by_role("tab", name="Today").click()
    expect(page.get_by_role("heading", name="Today", exact=True).last).to_be_visible()
    colour = page.get_by_role("heading", name="Today", exact=True).last.evaluate("(el) => getComputedStyle(el).color")
    assert colour == "rgb(245, 245, 245)", colour
    ok("in dark mode the Today screen draws light text (#F5F5F5) on the dark background")
    page.screenshot(path=f"{SHOTS}/06-today-dark.png")
    assert_square(page, "the Today screen in dark mode")

    # ---- desktop width ---------------------------------------------------------------------
    page.set_viewport_size({"width": 1280, "height": 800})
    page.get_by_role("tab", name="More").click()
    page.get_by_role("radio", name="Light").click()
    wait_for_background(page, "rgb(255, 255, 255)")
    width = page.evaluate("() => document.querySelector('[role=radiogroup]').getBoundingClientRect().width")
    assert width <= 720, width
    ok("on a desktop-width window the content stays in a readable column")
    page.screenshot(path=f"{SHOTS}/07-more-desktop.png")
    page.set_viewport_size({"width": 412, "height": 915})

    # ---- sign out ---------------------------------------------------------------------------
    button(page, "Sign out").click()
    expect(page.get_by_role("heading", name="TaskFlow", exact=True).last).to_be_visible()
    ok("Sign out returns to the sign-in screen")
    assert db(f"select count(*) from public.devices where user_id = '{user_id}'") == "0"
    ok("signing out removes this browser from the user's devices")
    page.reload()
    expect(page.get_by_role("heading", name="TaskFlow", exact=True).last).to_be_visible()
    ok("after a reload the user is still signed out")

    # ---- create an account ----------------------------------------------------------------------
    button(page, "Create account").click()
    field(page, "Name").fill("New Person")
    field(page, "Email").fill("new.person@example.com")
    field(page, "Password (at least 8 characters)").fill("a-long-password")
    button(page, "Create account").click()
    expect(page.get_by_text("Nothing due today. Tap + to add a task.")).to_be_visible()
    ok("creating an account signs the new user in, with an empty task list of their own")
    assert db("select name from public.profiles where email = 'new.person@example.com'") == "New Person"
    ok("the new account has a profile with the name that was typed")

    # ---- the sign-in return address ------------------------------------------------------------
    page.goto(WEB + "/auth-callback?error=access_denied&error_description=Email+link+is+invalid+or+has+expired")
    expect(page.get_by_role("alert").last).to_contain_text("Email link is invalid or has expired")
    ok("a failed sign-in link shows the reason instead of a blank page")

    browser.close()

assert problems == [], "browser reported problems:\n" + "\n".join(problems)
ok("the browser reported no errors during the whole run")
print(f"\n{passed} end-to-end checks passed.")
