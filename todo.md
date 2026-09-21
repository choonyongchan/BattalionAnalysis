Workflow 1: Revisit database schema

Analyse the parade state and formsg inputs and glean as much valuable information from these two data streams.

Refer to the existing Google Sheets schema and suggest a new improved database schema. Let me know what has been added and removed and why.

Workflow 1: Lean Whatsapp notifier
I need a Whatsapp logic that can message my own number to track the health of the whatsapp ingestor and formsg ingestor

Workflow 2: Whatsapp ingestor
Refer to ./whatsapp, but not copy.
I need a long-polling Whatsapp bot that reliably scrapes Whatsapp messages from a given Whatsapp chat, filter for noise, parse the parade state message and add into the database "parade_state". Also, sends me a Whatsapp message upon ingestion success or failure.

Workflow 3: FormSG ingestor
I need a webhook setup that accepts formsg responses, parse the formsg response, and add into the database "formsg". Also, send me a Whatsapp message

Workflow 4: Statistics Analyser

From the databoard, craft our logic to automatically calculate and tabulate relevant statistics of the dashboard upon new data entry.

Workflow 5: Database to Dashboard connection

Using RESTApi, refactor the dashboard to get the data from Database.

Workflow 6: Change the password to 40SARVictory!

Workflow 7: Add a feature to monitor parade state uploads (which company loaded and not in a calendar view) and to manually deposit parade states.

Workflow 8: (Maintain and analyse dashboard)