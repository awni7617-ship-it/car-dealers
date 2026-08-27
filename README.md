# Forecourt

A single-file dealership stock and enquiry tracker for UK used-car pitches.

Type a number plate, the car identifies itself, and Forecourt keeps the score
from there: who viewed it, who called, who is collecting it, and what it is
worth today.

## Running it

`forecourt.html` is self-contained — no build step, no dependencies. Open it in
a browser, or serve the directory:

```
python3 -m http.server 8000   # then visit http://localhost:8000/forecourt.html
```

## Storage

Data is kept per-browser in `localStorage`, behind the same interface the
Cloudflare D1 version uses, so the front end is unchanged between the two. In a
private window or with site data blocked, the app still runs and warns that
nothing is being saved.
