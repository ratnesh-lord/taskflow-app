"""
Groups end to end: two people in two browsers, through the real screens.

Alice chooses a username, creates a group and invites Bob by his username.
Bob accepts, a task Alice assigns to him lands in his Upcoming with a
message, he completes it and Alice sees it done. A private task of Alice's
never reaches Bob; a task Alice keeps is read-only for him. Alice removes
Bob and the group leaves his browser.

Run through run.sh:  E2E_SCRIPT=groups.py scripts/e2e/run.sh
"""
import os
import re
import subprocess

from playwright.sync_api import expect, sync_playwright

WEB = os.environ["E2E_WEB"]
DB = os.environ["E2E_DB"]
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/taskflow-e2e")
PASSWORD = "correct-password"
WAIT = 20000  # ms: what arrives through another browser waits for a sync
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


def button(page, name):
    return page.get_by_role("button", name=name, exact=True).filter(visible=True).last


def role(page, kind, name, **kw):
    return page.get_by_role(kind, name=name, **kw).filter(visible=True)


def field(page, label):
    return page.get_by_label(label, exact=True).filter(visible=True).last


def notice(page, text, timeout=5000):
    expect(page.get_by_role("alert").filter(has_text=text).last).to_be_visible(timeout=timeout)


def heading(page, name, timeout=5000):
    expect(page.get_by_role("heading", name=name, exact=True).filter(visible=True).last).to_be_visible(timeout=timeout)


def sign_in(page, email):
    page.goto(WEB + "/")
    heading(page, "TaskFlow")
    field(page, "Email").fill(email)
    field(page, "Password").fill(PASSWORD)
    button(page, "Sign in").click()
    heading(page, "Today", timeout=10000)


def go_more(page):
    page.get_by_role("tab", name="More").click()
    heading(page, "More")


def choose_username(page, typed, expected):
    go_more(page)
    button(page, "Choose a username").click()
    field(page, "Username").fill(typed)
    button(page, "Save username").click()
    notice(page, f"You are now @{expected}")
    expect(page.get_by_text(f"Username: @{expected}")).to_be_visible(timeout=WAIT)


db("select test.new_user('alice-groups@example.com', 'Alice Example')")
db("select test.new_user('bob-groups@example.com', 'Bob Example')")

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    problems = []

    def new_page(width, height):
        context = browser.new_context(viewport={"width": width, "height": height}, timezone_id="Asia/Kolkata", locale="en-GB")
        page = context.new_page()
        page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
        page.on("console", lambda m: problems.append(f"console error: {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        return page

    alice = new_page(412, 915)
    bob = new_page(1280, 800)

    # ---- usernames --------------------------------------------------------------
    sign_in(alice, "alice-groups@example.com")
    choose_username(alice, "  Alice_E2E ", "alice_e2e")
    ok("Alice chooses a username; it is stored in lower case and shown under Account")

    sign_in(bob, "bob-groups@example.com")
    go_more(bob)
    button(bob, "Choose a username").click()
    field(bob, "Username").fill("alice_e2e")
    button(bob, "Save username").click()
    notice(bob, "That username is taken")
    ok("a username someone else has is refused, in plain words")
    field(bob, "Username").fill("bob e2e")
    button(bob, "Save username").click()
    notice(bob, "cannot be a username")
    ok("a username with a space is refused before it is sent")
    field(bob, "Username").fill("bob_e2e")
    button(bob, "Save username").click()
    notice(bob, "You are now @bob_e2e")
    ok("Bob chooses bob_e2e")

    # ---- a group and an invitation -------------------------------------------------
    role(alice, "button", re.compile(r"^Groups")).last.click()
    heading(alice, "Groups")
    assert_square(alice, "the Groups screen")
    button(alice, "New group").click()
    field(alice, "Group name").fill("Flat 4")
    button(alice, "Create group").click()
    notice(alice, "Created Flat 4")
    expect(field(alice, "Group name")).to_have_value("Flat 4", timeout=WAIT)
    expect(alice.get_by_text("Owner", exact=True).filter(visible=True).last).to_be_visible(timeout=WAIT)
    ok("Alice creates Flat 4 and is its owner")

    button(alice, "Invite someone by username").click()
    field(alice, "Their username").fill("@nobody_here")
    button(alice, "Send invitation").click()
    notice(alice, "Nobody has the username nobody_here")
    ok("inviting a username nobody has says so")
    field(alice, "Their username").fill("@Bob_E2E")
    button(alice, "Send invitation").click()
    notice(alice, "Invitation sent to @bob_e2e")
    expect(alice.get_by_text("Invited, not joined yet").filter(visible=True).last).to_be_visible(timeout=WAIT)
    ok("Alice invites Bob by his username; he shows as invited")
    alice.screenshot(path=f"{SHOTS}/g1-group-owner.png")

    go_more(bob)
    expect(role(bob, "button", re.compile(r"^Groups.*1 invitation"))).to_be_visible(timeout=WAIT)
    ok("Bob's More screen shows the invitation without reloading")
    role(bob, "button", re.compile(r"^Groups")).last.click()
    heading(bob, "Groups")
    expect(bob.get_by_text("Alice Example invited you")).to_be_visible()
    assert "alice-groups@example.com" not in bob.content()
    ok("the invitation names Alice by her name, never her email address")
    button(bob, "Join").click()
    notice(bob, "Joined")
    expect(role(bob, "button", re.compile(r"^Flat 4, 2 people"))).to_be_visible(timeout=WAIT)
    ok("Bob joins; Flat 4 lists two people")
    bob.screenshot(path=f"{SHOTS}/g2-groups-bob.png")

    # ---- tasks: assigned, private, kept ----------------------------------------------
    def add_in_group(page, text, title):
        button(page, "Quick add").click()
        field(page, "New task").fill(text)
        button(page, "Add task").click()
        notice(page, f"Added: {title}")

    add_in_group(alice, "Take the bins out tomorrow", "Take the bins out")
    add_in_group(alice, "Plan the surprise party", "Plan the surprise party")
    add_in_group(alice, "Buy washing-up liquid", "Buy washing-up liquid")
    ok("Alice adds three tasks to the group with quick add")

    def open_task(page, title):
        role(page, "button", re.compile(rf"^{re.escape(title)}")).last.click()
        expect(field(page, "Title")).to_have_value(title)

    open_task(alice, "Take the bins out")
    expect(alice.get_by_text("Everyone in the group").filter(visible=True).last).to_be_visible()
    button(alice, "Assigned to: You").click()
    role(alice, "radio", "Bob Example (@bob_e2e)").last.click()
    notice(alice, "Assigned to Bob Example (@bob_e2e)")
    ok("Alice assigns the bins to Bob")
    assert_square(alice, "a group task")
    alice.screenshot(path=f"{SHOTS}/g3-task-assigned.png")
    button(alice, "Back").click()

    open_task(alice, "Plan the surprise party")
    button(alice, "Who sees it: Everyone in the group").click()
    role(alice, "radio", "Only its creator and the person it is assigned to").last.click()
    notice(alice, "Now private")
    button(alice, "Back").click()
    ok("Alice makes the party private")

    notice(bob, "Alice Example assigned you “Take the bins out”", timeout=WAIT)
    ok("Bob is told straight away that Alice assigned him a task")
    button(bob, "Back").click()  # from Groups to the tabs
    bob.get_by_role("tab", name="Upcoming").click()
    heading(bob, "Upcoming")
    expect(role(bob, "button", re.compile(r"^Take the bins out"))).to_be_visible(timeout=WAIT)
    expect(bob.get_by_text("Flat 4", exact=False).filter(visible=True).last).to_be_visible()
    ok("the assigned task is in Bob's own Upcoming list, marked with its group")
    bob.get_by_role("tab", name="Today").click()
    heading(bob, "Today")

    # Bob's view of the group: the bins and the liquid, never the private party.
    go_more(bob)
    role(bob, "button", re.compile(r"^Groups")).last.click()
    role(bob, "button", re.compile(r"^Flat 4")).last.click()
    expect(role(bob, "button", re.compile(r"^Buy washing-up liquid"))).to_be_visible(timeout=WAIT)
    expect(bob.get_by_text("Plan the surprise party")).to_have_count(0)
    assert db("select count(*) from public.tasks where title = 'Plan the surprise party' and is_private") == "1"
    ok("Bob sees the group's shared tasks but not Alice's private one")
    bob.screenshot(path=f"{SHOTS}/g4-group-member.png")

    open_task(bob, "Buy washing-up liquid")
    expect(bob.get_by_text("Only Alice Example (@alice_e2e) or the person it is assigned to can change this task", exact=False)).to_be_visible()
    expect(role(bob, "checkbox", "Complete: Buy washing-up liquid").last).to_be_disabled()
    expect(field(bob, "Title")).not_to_be_editable()
    ok("a task Alice keeps is read-only for Bob, and says who can change it")
    button(bob, "Back").click()

    role(bob, "checkbox", "Complete: Take the bins out").last.click()
    notice(bob, "Completed: Take the bins out")
    ok("Bob completes the task assigned to him")

    expect(alice.get_by_text("Take the bins out").filter(visible=True).last).to_be_visible()
    for _ in range(int(WAIT / 250)):
        if db("select status from public.tasks where title = 'Take the bins out'") == "completed":
            break
        alice.wait_for_timeout(250)
    assert db("select status from public.tasks where title = 'Take the bins out'") == "completed"
    expect(role(alice, "checkbox", "Reopen: Take the bins out")).to_be_visible(timeout=WAIT)
    ok("Alice sees it done in the group, live")

    # ---- removing Bob ------------------------------------------------------------------
    role(alice, "button", re.compile(r"^Bob Example \(@bob_e2e\), Member")).last.click()
    role(alice, "radio", "Remove from the group").last.click()
    notice(alice, "Bob Example (@bob_e2e) removed")
    ok("Alice removes Bob")
    expect(bob.get_by_text("This group is not here")).to_be_visible(timeout=WAIT)
    button(bob, "Go to Groups").click()
    heading(bob, "Groups")
    expect(role(bob, "button", re.compile(r"^Flat 4"))).to_have_count(0)
    ok("the group and its tasks leave Bob's browser")

    assert not problems, problems
    ok("no page errors or console errors in either browser")
    browser.close()

print(f"\nAll {passed} group checks passed.")
