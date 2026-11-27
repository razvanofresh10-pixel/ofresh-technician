from pathlib import Path

p = Path("index.html")
s = p.read_text(encoding="utf-8")
bad = "</div>')}`</section><section class=\"panel\">"
good = "</div>')}</section><section class=\"panel\">"
count = s.count(bad)
if count != 1:
    raise SystemExit(f"Expected exactly one broken stockPage template boundary, found {count}; refusing to publish.")
s = s.replace(bad, good, 1)
p.write_text(s, encoding="utf-8")
print("Fixed stockPage HTML template boundary.")
