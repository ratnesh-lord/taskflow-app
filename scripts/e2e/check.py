"""
Web end-to-end check. Drives the exported web app in headless Chrome against
mock-supabase.mjs (fake sign-in, real Postgres) and asserts what a person would see.

Environment: E2E_WEB (address of the web app), E2E_DB (database name), E2E_SHOTS (folder for screenshots)
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

WEB = os.environ["E2E_WEB"]
API = os.environ.get("E2E_API", "http://127.0.0.1:54400")
DB = os.environ["E2E_DB"]
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/taskflow-e2e")
EMAIL = "e2e@example.com"
PASSWORD = "correct-password"
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


def open_tab(page, name):
    """Switch tabs and wait for that screen, so the next tap lands on it."""
    page.get_by_role("tab", name=name).click()
    expect(page.get_by_role("heading", name=name, exact=True).filter(visible=True)).to_be_visible()


def sign_out(page):
    """Tap Sign out; if changes are still waiting to be sent, the app asks once more."""
    button(page, "Sign out").click()
    try:
        expect(page.get_by_role("heading", name="TaskFlow", exact=True).filter(visible=True)).to_be_visible(timeout=3000)
    except AssertionError:
        expect(page.get_by_text("Tap Sign out again to continue.", exact=False).filter(visible=True)).to_be_visible()
        button(page, "Sign out").click()
        expect(page.get_by_role("heading", name="TaskFlow", exact=True).filter(visible=True)).to_be_visible()


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
    for name in ["Open", "Completed", "Both"]:
        box = role(page, "radio", name).first.bounding_box()
        assert box and box["width"] >= 60, f"the Show option {name} is squeezed: {box}"
    ok("the Show switch in Filter and sort has room for each of its options")
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

    # ---- calendar (Phase 7): day, week, month and agenda views; drag to reschedule ----------
    tomorrow = today + timedelta(days=1)

    def drag(source, dx=0, dy=0, to=None):
        """Touch and hold (here: press the mouse) for 0.6 s, then move and let go."""
        source.scroll_into_view_if_needed()
        box = source.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + min(10, box["height"] / 2)
        tx, ty = (to if to else (x + dx, y + dy))
        page.mouse.move(x, y)
        page.mouse.down()
        page.wait_for_timeout(600)
        page.mouse.move(x + (tx - x) / 3, y + (ty - y) / 3, steps=5)
        page.mouse.move(tx, ty, steps=10)
        page.wait_for_timeout(150)
        page.mouse.up()

    button(page, "Back").click()
    go("Upcoming")
    role(page, "radio", "Calendar", exact=True).first.click()
    expect(role(page, "radio", "Day", exact=True).first).to_have_attribute("aria-checked", "true")
    expect(page.get_by_text(re.compile(r"^All day$")).filter(visible=True).first).to_be_visible()
    plants_today = role(page, "button", re.compile(r"^Water the plants.*completed$")).filter(visible=True)
    expect(plants_today.first).to_be_visible()
    ok("Upcoming → Calendar opens today's hour grid, with today's ticked-off repeat marked done")
    button(page, "Later").click()
    aws_block = role(page, "button", re.compile(r"^Complete AWS certification revision, 19:00$")).filter(visible=True)
    expect(aws_block.first).to_be_visible()
    expect(role(page, "button", re.compile(r"^Water the plants$")).filter(visible=True).first).to_be_visible()
    ok("tomorrow shows the AWS task at 19:00 on the grid and the daily repeat in the all-day row")
    assert_square(page, "the day view")
    page.screenshot(path=f"{SHOTS}/20-calendar-day.png")

    drag(aws_block.first, dy=-3 * 48)
    notice("Moved to ")
    expect(role(page, "button", re.compile(r"^Complete AWS certification revision, 16:00$")).filter(visible=True).first).to_be_visible()
    ok("dragging the task up three hours moves it to 16:00 (snapped to the quarter hour)")
    page.get_by_role("alert").get_by_role("button", name="Undo").click()
    expect(aws_block.first).to_be_visible()
    ok("Undo puts it back at 19:00")

    plants_tomorrow = role(page, "button", re.compile(r"^Water the plants$")).filter(visible=True).first
    aws_now = role(page, "button", re.compile(r"^Complete AWS certification revision, 19:00$")).filter(visible=True).first
    aws_now.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    line_17 = aws_now.bounding_box()["y"] - 1 - 2 * 48  # the block's top is the 19:00 line plus 1
    # An all-day item is held near its top edge, so the pointer goes just under the 17:00 line.
    drag(plants_tomorrow, to=(206, line_17 + 6))
    notice("Moved to ")
    expect(role(page, "button", re.compile(r"^Water the plants, 17:00$")).filter(visible=True).first).to_be_visible()
    ok("dragging the daily repeat from the all-day row onto the grid gives that one day a time (17:00)")

    role(page, "radio", "Week", exact=True).first.click()
    expect(role(page, "button", re.compile(r"^Complete AWS certification revision, 19:00$")).filter(visible=True).first).to_be_visible()
    week_plants = role(page, "button", re.compile(r"^Water the plants$")).filter(visible=True)
    expect(week_plants.first).to_be_visible()
    page.screenshot(path=f"{SHOTS}/21-calendar-week.png")
    aws_week = role(page, "button", re.compile(r"^Complete AWS certification revision, 19:00$")).filter(visible=True).first
    column = (412 - 2 * 20 - 44) / 7
    days_right = 1 if tomorrow.weekday() < 6 else -1
    drag(aws_week, dx=days_right * column)
    moved_to = tomorrow + timedelta(days=days_right)
    notice(f"Moved to {moved_to.strftime('%a')} {moved_to.day} {moved_to.strftime('%b')}, 19:00")
    expect(role(page, "button", re.compile(r"^Complete AWS certification revision, 19:00$")).filter(visible=True)).to_have_count(1)
    ok(f"in the week view, dragging sideways moves the task to the next day's column ({moved_to.isoformat()})")
    page.get_by_role("alert").get_by_role("button", name="Undo").click()

    role(page, "radio", "Month", exact=True).first.click()
    page.screenshot(path=f"{SHOTS}/22-calendar-month.png")
    role(page, "radio", "Agenda", exact=True).first.click()
    expect(role(page, "button", re.compile(r"^Complete AWS certification revision, 19:00")).filter(visible=True).first).to_be_visible()
    page.screenshot(path=f"{SHOTS}/23-calendar-agenda.png")
    ok("month and agenda views list the same tasks")
    role(page, "radio", "7 days").first.click()

    # ---- colours and pictures: priority and project colours, emoji, clipart and a photo ------
    role(page, "button", re.compile(r"^Complete AWS certification revision")).first.click()
    expect(role(page, "button", "Project: None").first).to_contain_text("None")
    expect(role(page, "button", "Picture: None").first).to_contain_text("None")
    role(page, "button", re.compile(r"^Picture: None$")).first.click()
    role(page, "radio", "Emoji 🎂").first.click()
    expect(role(page, "button", "Picture: Emoji 🎂").first).to_be_visible()
    role(page, "button", re.compile(r"^Picture: ")).first.click()
    role(page, "radio", "Clipart", exact=True).first.click()
    role(page, "radio", "Clipart: Study").first.click()
    expect(role(page, "button", "Picture: Clipart: Study").first).to_be_visible()
    ok("a task takes an emoji, then a clipart drawing instead")

    # A photo: a real JPEG made here, picked through the browser's file chooser, shrunk and uploaded.
    photo = f"{SHOTS}/photo.jpg"
    page.evaluate("""() => new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600;
      const g = c.getContext('2d'); g.fillStyle = '#0F766E'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#FBBF24'; g.fillRect(300, 150, 300, 300);
      c.toBlob((b) => b.arrayBuffer().then((a) => { window.__photo = Array.from(new Uint8Array(a)); resolve(); }), 'image/jpeg', 0.9);
    })""")
    with open(photo, "wb") as f:
        f.write(bytes(page.evaluate("() => window.__photo")))
    role(page, "button", re.compile(r"^Picture: ")).first.click()
    role(page, "radio", "Photo", exact=True).first.click()
    with page.expect_file_chooser() as chooser:
        button(page, "Choose a photo").click()
    chooser.value.set_files(photo)
    expect(role(page, "button", "Picture: Photo").first).to_be_visible(timeout=20000)
    expect(page.locator("img[src*='/storage/v1/object/sign/attachments/']").filter(visible=True).first).to_be_visible(timeout=15000)
    ok("a photo is cropped, uploaded to the account's private storage and shown through a signed address")
    page.screenshot(path=f"{SHOTS}/24-task-picture.png")

    # Colours: by priority (the default), then by project with a chosen project colour.
    role(page, "button", re.compile(r"^Picture: ")).first.click()
    role(page, "radio", "Emoji", exact=True).first.click()
    role(page, "radio", "Emoji 🎓").first.click()
    button(page, "Back").click()
    go("More")
    button(page, "Colours").click()
    expect(role(page, "radio", "Priority", exact=True).first).to_have_attribute("aria-checked", "true")
    role(page, "button", "High: Orange").first.click()
    role(page, "radio", "Violet").first.click()
    expect(role(page, "button", "High: Violet").first).to_be_visible()
    assert_square(page, "the Colours page")
    ok("More → Colours: tasks are coloured by priority, and a priority's colour can be changed (high → violet)")
    button(page, "Back").click()
    go("Upcoming")
    page.screenshot(path=f"{SHOTS}/25-colours-by-priority.png")

    go("More")
    button(page, "Colours").click()
    role(page, "radio", "Project", exact=True).first.click()
    button(page, "Back").click()
    go("Projects")
    role(page, "button", re.compile(r"^Cloud exam")).first.click()
    role(page, "button", "Colour: None").first.click()
    role(page, "radio", "Teal").first.click()
    expect(role(page, "button", "Colour: Teal").first).to_be_visible()
    ok("a project gets its own colour, and tasks can be coloured by project instead")
    page.screenshot(path=f"{SHOTS}/26-project-colour.png")
    button(page, "Back").click()
    go("Upcoming")
    page.screenshot(path=f"{SHOTS}/27-colours-by-project.png")
    role(page, "radio", "Calendar", exact=True).first.click()
    role(page, "radio", "Week", exact=True).first.click()
    page.screenshot(path=f"{SHOTS}/28-calendar-colours.png")
    role(page, "radio", "7 days", exact=True).first.click()

    page.goto(WEB + "/")  # a full page load: everything below comes from the browser's database
    expect(page.get_by_text(re.compile(r"^Done today · 3$", re.I)).filter(visible=True).first).to_be_visible()
    role(page, "button", re.compile(r"^Done: 3\.")).first.click()
    expect(page.get_by_text("Showing tasks done today only").filter(visible=True)).to_be_visible()
    expect(page.get_by_text(re.compile(r"^Today · ", re.I)).filter(visible=True)).to_have_count(0)
    expect(page.get_by_text(re.compile(r"^Done today · 3$", re.I)).filter(visible=True).first).to_be_visible()
    role(page, "button", re.compile(r"^Pending: ")).first.click()
    expect(page.get_by_text(re.compile(r"^Done today · ", re.I)).filter(visible=True)).to_have_count(0)
    button(page, "Show all").click()
    expect(page.get_by_text(re.compile(r"^Done today · 3$", re.I)).filter(visible=True).first).to_be_visible()
    ok("tapping a count on Today shows only those tasks, and Show all brings the rest back")
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
    expect(page.get_by_text("Every change on this device has been sent.").filter(visible=True)).to_be_visible(timeout=15000)
    expect(page.get_by_text(re.compile(r"^Synced with your account at ")).filter(visible=True)).to_be_visible()
    ok("More says every change has been synced with the account")

    # ---- sync (Phase 4): this browser's tasks are in the real database --------------------
    titles = db(f"select string_agg(title, '|' order by title) from public.tasks where user_id = '{user_id}' and deleted_at is null")
    for t in ["Complete AWS certification revision", "Water the plants", "Renew passport", "Read the networking chapter"]:
        assert t in titles.split("|"), titles
    assert db(f"select count(*) from public.task_occurrences where user_id = '{user_id}' and status = 'completed'") == "1"
    assert db(f"select count(*) from public.saved_filters where user_id = '{user_id}' and name = 'Important'") == "1"
    ok("every task, repeat completion and saved filter made in this browser is in the database")
    moved = db(f"select o.moved_to_date || ' ' || o.moved_to_time from public.task_occurrences o join public.tasks t on t.id = o.task_id "
               f"where t.title = 'Water the plants' and o.status = 'skipped' and o.occurrence_date = '{tomorrow.isoformat()}'")
    assert moved == f"{tomorrow.isoformat()} 17:00:00", moved
    assert db(f"select due_date || ' ' || due_time from public.tasks where title = 'Complete AWS certification revision'") == f"{tomorrow.isoformat()} 19:00:00"
    ok("the calendar drags reached the database: tomorrow's watering moved to 17:00, the AWS task back at 19:00 after Undo")
    assert db("select icon from public.tasks where title = 'Complete AWS certification revision'") == "e:🎓"
    colours = json.loads(db(f"select settings -> 'colors' from public.profiles where id = '{user_id}'"))
    assert colours == {"by": "project", "priority": {"critical": "red", "high": "violet", "medium": "blue", "low": "grey"}}, colours
    assert db("select color from public.projects where name = 'Cloud exam'") == "teal"
    ok("the picture, the colour settings and the project colour reached the database")
    stamp = db(f"select field_ts ->> 'title' from public.tasks where user_id = '{user_id}' and title = 'Renew passport'")
    assert re.fullmatch(r"\d{15}:\d{5}:[0-9a-f-]{36}", stamp), stamp
    ok("each field carries a device timestamp in the agreed format")
    # Chrome reports India's zone under its older name, Asia/Calcutta; both names are the same zone.
    stored = db(f"select timezone from public.profiles where id = '{user_id}'")
    assert stored in ("Asia/Kolkata", "Asia/Calcutta"), stored
    ok(f"the account's time zone was updated from this device ({stored})")

    # ---- a second device: another browser, signed in to the same account --------------------
    other_context = browser.new_context(
        viewport={"width": 412, "height": 915}, device_scale_factor=2,
        timezone_id="Asia/Kolkata", locale="en-GB", color_scheme="light",
    )
    other = other_context.new_page()
    other.on("pageerror", lambda e: problems.append(f"second device page error: {e}"))
    other.goto(WEB + "/")
    field(other, "Email").fill(EMAIL)
    field(other, "Password").fill(PASSWORD)
    button(other, "Sign in").click()
    expect(other.get_by_text(re.compile(r"^Done today · 3$", re.I)).filter(visible=True).first).to_be_visible(timeout=15000)
    open_tab(other, "Upcoming")
    expect(role(other, "button", re.compile(r"^Complete AWS certification revision, Tomorrow 19:00")).first).to_be_visible()
    ok("a second device signing in gets every task, with the same dates, times and completions")

    open_tab(other, "Today")
    button(other, "Quick add").click()
    field(other, "New task").fill("Made on the second device")
    button(other, "Add task").click()
    expect(other.get_by_text("Made on the second device").filter(visible=True).first).to_be_visible()
    open_tab(page, "Today")
    expect(page.get_by_text("Made on the second device").filter(visible=True).first).to_be_visible(timeout=15000)
    ok("a task added on the second device appears on the first by itself, live")

    other_context.set_offline(True)
    button(other, "Quick add").click()
    field(other, "New task").fill("Written while offline")
    button(other, "Add task").click()
    expect(other.get_by_text(re.compile(r"^Not synced \(No connection\)\. 1 change will go up")).filter(visible=True)).to_be_visible(timeout=15000)
    ok("offline, the task is saved on the device and Today says it will go up later")
    assert db(f"select count(*) from public.tasks where user_id = '{user_id}' and title = 'Written while offline'") == "0"
    other_context.set_offline(False)
    open_tab(other, "More")
    button(other, "Sync now").click()
    expect(other.get_by_text("Every change on this device has been sent.").filter(visible=True)).to_be_visible(timeout=15000)
    expect(page.get_by_text("Written while offline").filter(visible=True).first).to_be_visible(timeout=15000)
    ok("back online, it goes up and reaches the first device")

    # The same task edited on both devices: different fields both survive.
    page.get_by_role("button", name=re.compile(r"^Written while offline")).filter(visible=True).first.click()
    button(page, "Priority: Medium").click()
    page.get_by_role("radio", name="Critical").last.click()
    expect(button(page, "Priority: Critical")).to_be_visible()
    open_tab(other, "Today")
    other.get_by_role("button", name=re.compile(r"^Written while offline")).filter(visible=True).first.click()
    field(other, "Notes").fill("Added on the second device")
    field(other, "Title").click()
    expect(page.get_by_text("Added on the second device")).to_have_count(0)
    expect(field(page, "Notes")).to_have_value("Added on the second device", timeout=15000)
    expect(button(other, "Priority: Critical")).to_be_visible(timeout=15000)
    ok("edits to different fields of one task on two devices are merged, not overwritten")
    other_context.close()
    button(page, "Back").click()

    # ---- reminders settings (Phase 5; the alarms themselves need the Android app) -------------
    open_tab(page, "More")
    button(page, "Reminders and summaries").click()
    expect(page.get_by_role("heading", name="Reminders", exact=True).filter(visible=True)).to_be_visible()
    expect(page.get_by_text(re.compile(r"^In a browser, reminders are saved and synced to your phone")).filter(visible=True)).to_be_visible()
    ok("in a browser, the Reminders page says the phone app shows the reminders")
    button(page, "Morning plan: 08:00").click()
    page.get_by_role("radio", name="07:30").last.click()
    expect(button(page, "Morning plan: 07:30")).to_be_visible()
    button(page, "Evening check: 21:00").click()
    page.get_by_role("radio", name="Off").last.click()
    expect(button(page, "Evening check: Off")).to_be_visible()
    for _ in range(30):
        settings = db(f"select settings -> 'notifications' from public.profiles where id = '{user_id}'")
        if settings and json.loads(settings) == {"morning": "07:30", "evening": None}:
            break
        page.wait_for_timeout(500)
    assert json.loads(settings) == {"morning": "07:30", "evening": None}, settings
    ok("summary times are saved to the account, so every device uses them")
    assert_square(page, "the Reminders page")
    button(page, "Back").click()

    # ---- Google (Phase 7): this build has no web client id, so the page says so ---------------
    button(page, "Google Calendar, Tasks and Drive").click()
    expect(page.get_by_role("heading", name="Google", exact=True).filter(visible=True)).to_be_visible()
    expect(page.get_by_text(re.compile(r"^Google is not set up for the web version of this build")).filter(visible=True)).to_be_visible()
    ok("without a Google client id the Google page explains it is not set up, instead of offering buttons that fail")
    button(page, "Back").click()

    # ---- export and restore -----------------------------------------------------------------
    open_tab(page, "More")
    with page.expect_download() as download_info:
        button(page, "Export all data").click()
    download = download_info.value
    assert re.fullmatch(r"taskflow-backup-\d{4}-\d\d-\d\d\.json", download.suggested_filename), download.suggested_filename
    backup_path = f"{SHOTS}/{download.suggested_filename}"
    download.save_as(backup_path)
    with open(backup_path) as f:
        backup = json.load(f)
    assert backup["format"] == "taskflow-backup" and backup["version"] == 1
    exported = sorted(t["title"] for t in backup["tables"]["tasks"])
    assert "Renew passport" in exported and "Written while offline" in exported, exported
    ok(f"Export all data downloads a backup file with every task ({len(exported)} tasks)")

    open_tab(page, "Today")
    role(page, "button", re.compile(r"^Written while offline")).first.click()
    button(page, "Delete").click()
    expect(role(page, "button", re.compile(r"^Written while offline"))).to_have_count(0)
    open_tab(page, "More")
    with page.expect_file_chooser() as chooser_info:
        button(page, "Restore from a backup").click()
    chooser_info.value.set_files(backup_path)
    dialog = page.get_by_role("dialog", name="Restore backup")
    expect(dialog.get_by_text(re.compile(rf"It holds {len(exported)} tasks"))).to_be_visible()
    ok("choosing the backup file shows what it holds before anything changes")
    button(page, "Restore").click()
    expect(page.get_by_role("alert").filter(has_text="Backup restored").last).to_be_visible()
    open_tab(page, "Today")
    expect(role(page, "button", re.compile(r"^Written while offline")).first).to_be_visible()
    ok("restoring brings back a task deleted after the backup")
    expect(page.get_by_text("Made on the second device").filter(visible=True).first).to_be_visible()
    open_tab(page, "More")
    expect(page.get_by_text("Every change on this device has been sent.").filter(visible=True)).to_be_visible(timeout=15000)
    assert db(f"select count(*) from public.tasks where user_id = '{user_id}' and title = 'Written while offline' and deleted_at is null") == "1"
    ok("the restored task is back in the account's database too")
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
    sign_out(page)
    expect(page.get_by_role("heading", name="TaskFlow", exact=True).last).to_be_visible()
    ok("Sign out returns to the sign-in screen")
    assert db(f"select count(*) from public.devices where user_id = '{user_id}'") == "1"
    ok("signing out removes this browser from the user's devices (the second browser, still signed in, stays)")
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
    page.goto(WEB + "/auth-callback?error=access_denied&error_description=Something+else+went+wrong")
    expect(page.get_by_role("alert").last).to_contain_text("Something else went wrong")
    ok("a failed sign-in link shows the reason instead of a blank page")

    # ---- password reset, the whole way round (the mock follows Supabase's PKCE reset) -----------
    button(page, "Back to sign in").click()
    page.get_by_role("tab", name="More").click()  # still signed in as the new account
    sign_out(page)
    page.get_by_role("button", name=re.compile("Forgot password")).filter(visible=True).last.click()
    expect(page.get_by_role("heading", name="Reset password", exact=True).filter(visible=True)).to_be_visible()
    field(page, "Email").fill("new.person@example.com")
    button(page, "Send reset link").click()
    expect(page.get_by_text("a reset link is on its way", exact=False).filter(visible=True).first).to_be_visible()
    with urllib.request.urlopen(f"{API}/auth/v1/test/mailbox?email=new.person@example.com") as reply:
        link = json.load(reply)["link"]
    page.goto(link)
    expect(page.get_by_role("heading", name="New password", exact=True).filter(visible=True)).to_be_visible()
    ok("the reset email's link opens the New password screen")
    field(page, "New password (at least 8 characters)").fill("a-brand-new-password")
    button(page, "Save password").click()
    expect(page.get_by_role("heading", name="Today", exact=True).filter(visible=True)).to_be_visible()
    ok("saving the new password signs the user in")
    go_more = page.get_by_role("tab", name="More")
    go_more.click()
    sign_out(page)
    field(page, "Email").fill("new.person@example.com")
    field(page, "Password").fill("a-long-password")
    button(page, "Sign in").click()
    expect(page.get_by_role("alert").filter(visible=True).last).to_contain_text("do not match")
    field(page, "Password").fill("a-brand-new-password")
    button(page, "Sign in").click()
    expect(page.get_by_role("heading", name="Today", exact=True).filter(visible=True)).to_be_visible()
    ok("afterwards the old password is refused and the new one works")
    page.get_by_role("tab", name="More").click()
    sign_out(page)

    page.goto(link)
    expect(page.get_by_role("heading", name="That link did not work").filter(visible=True)).to_be_visible()
    expect(page.get_by_role("alert").filter(visible=True).last).to_contain_text("Each email link works once")
    ok("opening the same link again explains that each link works once (its error arrives after the #)")
    button(page, "Get a new link").click()
    expect(page.get_by_role("heading", name="Reset password", exact=True).filter(visible=True)).to_be_visible()
    ok("and offers a button straight to asking for a new link")

    browser.close()

assert problems == [], "browser reported problems:\n" + "\n".join(problems)
ok("the browser reported no errors during the whole run")
print(f"\n{passed} end-to-end checks passed.")
