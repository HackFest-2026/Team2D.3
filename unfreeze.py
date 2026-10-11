import sqlite3

con = sqlite3.connect("backend/test.db")
cur = con.cursor()
cur.execute("UPDATE incidents SET status='Resumed' WHERE status='Alert'")
con.commit()
print("Updated stale alerts to Resumed. Count:", cur.rowcount)
