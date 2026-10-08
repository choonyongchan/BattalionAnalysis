# 40 SAR Personnel Dashboard

[![codecov](https://codecov.io/gh/choonyongchan/BattalionDataAnalysis/graph/badge.svg)](https://codecov.io/gh/choonyongchan/BattalionDataAnalysis)

The battalion's daily personnel picture in one place: who filed a parade state, how many soldiers
are present, who is on MC, MA, status or reporting sick, and how that is trending. It reads three
sources:

- **Parade states** posted in the WhatsApp group, relayed automatically, or pasted on the Deposit
  page.
- **Report-sick submissions** from the FormSG form.
- **Self-Regulated Fitness Training (SFT)** submissions from their own FormSG form.

Open it at **https://40sar.vercel.app**.

> This guide is for the people who use the dashboard. To maintain or change it, read
> [docs/DeveloperGuide.md](docs/DeveloperGuide.md).

## Logging in

Enter the dashboard password you were given and press **Enter**. There are two passwords:

- The **read** password shows every page and lets you deposit and correct parade states.
- The **settings** password also lets you change Settings.

You stay logged in for the working day. Press **Lock** at the bottom of the sidebar when you leave
a shared computer. The data refreshes by itself every minute while the tab is open.

Never share the passwords over chat, and never paste a screenshot of the dashboard into a group:
it shows soldiers' names and medical information.

## The bar at the top of every page

- **All / Archer / Braves / Cougar / Stallion / Hercules** narrows every chart on the page to one
  company.
- **All dates** opens the date range. Trends, rankings and heatmaps follow it. The figures on
  **Today** always describe that day's single parade.
- Every chart has a **Chart / Table** switch. The table holds the exact numbers.

## The pages

| Page | Use it to answer |
|---|---|
| **Today** | Which companies have filed this morning? How many soldiers do I have and how many are present? Who is out of camp and why, and what are the "other duties"? Which restrictions are in force in each company (hover a cell for names)? How many are already known to be away over the next 14 days, who is back when, and who just came back? |
| **Duty Roster** | Who is on duty today, from the CDO down, and which posts were filed vacant? Who has done the most duties (weekends counted apart), and was anyone rostered on a day they were on MC or leave? |
| **Report Sick** | Is an illness spreading? **Outbreak Watch** shows new fever, flu and stomach cases by platoon over the last two weeks and names any platoon with 3 cases in 3 days. Also: how many are reporting sick on the parade state and on FormSG, which company and platoon, which type, what soldiers say is wrong, and at what time they report. |
| **MC / MA** | Who is on MC or medical appointment, and which clinics? **MC Pattern** puts each soldier on a chart, number of MCs against days lost, so many short MCs stand apart from a few long ones. **MC Length** shows how long MCs run for each symptom. **When MCs Start** shows the weekday, and how many start on a Monday, a Friday or beside a public holiday. |
| **Status & Restrictions** | Who holds an excuse or light duty, and which kinds are most common? **SFT While Restricted** lists SFT logged on a day the soldier held a training restriction. Check each one; some may be allowed. |
| **Trends** | Strength, report sick (parade state against FormSG), MC / MA and Status over the date range, and how report sick flows into FormSG outcomes. |
| **SFT** | How many soldiers trained, in which companies, in what group sizes, where and doing what? |
| **Soldier** | One soldier's full history: search by name or 4D. |
| **Filing & Accuracy** | How many minutes past 08:00 each company's first parade state arrived each day, sections whose stated count does not match the names listed, and how much of the battalion the data covers. |
| **Deposit** | Add a parade state WhatsApp missed, fix one the system could not read, or correct an SFT record. |
| **Settings** | Unit name and crest, public holidays and rotations, thresholds, session length. |

Platoons come from the sub-header each name is listed under in the parade state. A name under a
sub-header the company does not have shows as **Unassigned**.

Counts are of soldiers, not lines: a soldier listed twice on one day counts once. A day a company
did not file shows as zero or a gap, and every chart says how much of the battalion it covers.

## Depositing and fixing a parade state

1. Open **Deposit** and stay on **Parade State**.
2. Paste the whole parade state, exactly as posted, and press **Deposit**.
3. The page says **Saved** with the company and date, or lists the lines it could not read.
4. To fix a stored message, find it in the list (newest first) and press **Edit**. The lines to
   fix are shown above the text. Correct them and save. Nothing changes until the text reads
   cleanly.
5. **Delete** removes a message and everything read from it. It asks once more before it does.

The list shows each message's status:

- **Parsed**: its numbers are in the charts.
- **Needs review**: some lines could not be read; the count says how many. Open it with **Edit**.
- **Rejected**: a last parade state, or not a parade state at all.
- **Pending**: received but not read yet.

## Correcting an SFT record

Records come only from the FormSG form. On **Deposit → SFT**, search the list, press **Edit**,
correct any answer and save, or **Delete** a duplicate.

## Changing settings

Log in with the settings password, open **Settings** and press **Edit** on a section. Holidays
and rotations live under **Calendar**; holidays draw as lines on every trend. If someone else
saved the same section first, the page says so: reload and try again.

## Something looks wrong

| You see | Do this |
|---|---|
| A company never lights up under "Today's First Parade State" | Check the WhatsApp group for its parade state; if it is there, deposit it by hand |
| A parade state shows **Needs review** | Open it with **Edit** and correct the listed lines |
| The login screen keeps coming back | Your session ended or the password changed; ask for the current one |
| A number looks wrong | Switch the chart to **Table** and compare with the parade state; report it to the maintainer with the date and company |
