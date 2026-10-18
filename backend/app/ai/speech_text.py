"""Turns an answer into text that reads well aloud.

Applied immediately before text-to-speech, never to the visible answer. Dates,
money and percentages become words ("Oct 24, 2026" -> "October twenty-fourth,
twenty twenty-six", "$12.20" -> "twelve dollars and twenty cents"), leftover
Markdown is dropped and a few finance abbreviations are spelled out. Matching is
contextual: a month abbreviation only counts when a day number follows it, only
amounts with a "$" are money, and bare numbers are left alone (speech engines read
"4 payments" fine, and "2027" on its own may or may not be a year).

No numeric value is changed: every digit of the original is preserved in words.
"""
import re

ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
ORDINAL_ONES = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
                "nine": "ninth", "twelve": "twelfth"}
SCALES = [(1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")]

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
               "November", "December"]
MONTHS = {name.lower(): name for name in MONTH_NAMES} | {name[:3].lower(): name for name in MONTH_NAMES} | {"sept": "September"}
# Capitalised forms only: "May 5" is a date, "you may 5 times" is not.
MONTH_WORDS = sorted({MONTHS[k][: len(k)] if k != "sept" else "Sept" for k in MONTHS}, key=len, reverse=True)

ABBREVIATIONS = {
    "APR": "annual percentage rate",
    "APY": "annual percentage yield",
    "yr": "year",
    "yrs": "years",
    "mins": "minutes",
    "vs.": "versus",
    "vs": "versus",
    "e.g.": "for example",
    "i.e.": "that is",
    "approx.": "approximately",
}


def cardinal(n: int) -> str:
    """0 -> "zero", 230 -> "two hundred thirty", 1200 -> "one thousand two hundred"."""
    if n < 0:
        return "negative " + cardinal(-n)
    if n == 0:
        return "zero"
    parts: list[str] = []
    for value, name in SCALES:
        if n >= value:
            parts.append(f"{cardinal(n // value)} {name}")
            n %= value
    if n >= 100:
        parts.append(f"{ONES[n // 100]} hundred")
        n %= 100
    if n >= 20:
        parts.append(TENS[n // 10] + (f"-{ONES[n % 10]}" if n % 10 else ""))
    elif n:
        parts.append(ONES[n])
    return " ".join(parts)


def ordinal(n: int) -> str:
    """1 -> "first", 24 -> "twenty-fourth", 30 -> "thirtieth"."""
    words = cardinal(n)
    head, sep, last = words.rpartition("-") if "-" in words.rsplit(" ", 1)[-1] else words.rpartition(" ")
    if last in ORDINAL_ONES:
        last = ORDINAL_ONES[last]
    elif last.endswith("y"):
        last = last[:-1] + "ieth"
    else:
        last += "th"
    return f"{head}{sep}{last}"


def year_words(year: int) -> str:
    """2026 -> "twenty twenty-six", 2005 -> "two thousand five", 1999 -> "nineteen ninety-nine"."""
    if year < 1000 or year > 9999:
        return cardinal(year)
    century, rest = divmod(year, 100)
    if rest == 0:
        return f"{cardinal(century)} hundred" if century % 10 else cardinal(year)
    if century % 10 == 0 and rest < 10:  # 2005, 1007
        return f"{cardinal(year - rest)} {cardinal(rest)}"
    if century % 10 == 0:  # 2010-2099: "twenty ten"
        return f"{cardinal(century)} {cardinal(rest)}"
    return f"{cardinal(century)} {('oh ' + cardinal(rest)) if rest < 10 else cardinal(rest)}"


def digits(s: str) -> str:
    """"99" -> "nine nine" (digits after a decimal point are read one by one)."""
    return " ".join("zero" if c == "0" else ONES[int(c)] for c in s)


def money_words(sign: str, whole: str, cents: str | None) -> str:
    dollars = int(whole.replace(",", ""))
    c = int(cents.ljust(2, "0")) if cents else 0
    d_part = f"{cardinal(dollars)} {'dollar' if dollars == 1 else 'dollars'}"
    c_part = f"{cardinal(c)} {'cent' if c == 1 else 'cents'}"
    if c == 0:
        words = d_part
    elif dollars == 0:
        words = c_part
    else:
        words = f"{d_part} and {c_part}"
    return f"{sign}{words}"


def _sign_word(raw: str) -> str:
    raw = raw.strip()
    if raw in ("-", "−", "–") or raw.lower().startswith(("minus", "negative")):
        return "negative "
    if raw == "+":
        return "plus "
    return ""


# ---- patterns -----------------------------------------------------------------------------

_SIGN = r"(?P<sign>(?:[-−–+]|minus\s|negative\s)?)"
_APPROX = r"(?P<approx>≈\s*|~\s*)?"
MONEY = re.compile(_APPROX + _SIGN + r"\$\s?(?P<neg2>[-−])?(?P<whole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?P<cents>\d{1,2}))?(?!\d)")
ISO_DATE = re.compile(r"(?<!\d)(?P<y>\d{4})-(?P<m>0[1-9]|1[0-2])-(?P<d>0[1-9]|[12]\d|3[01])(?!\d)")
MONTH_DATE = re.compile(
    r"\b(?P<month>" + "|".join(MONTH_WORDS) + r")\.?\s+(?P<day>[0-3]?\d)(?!\d)(?P<suffix>st|nd|rd|th)?"
    r"(?:,?\s+(?P<year>(?:19|20)\d{2})(?!\d))?",
)
PERCENT = re.compile(_SIGN + r"(?P<whole>\d+)(?:\.(?P<frac>\d+))?\s?%(?P<per>\s?/\s?(?:yr|year|mo|month))?")
MARKDOWN_EMPHASIS = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(?<![\w*])([*_])(?=\S)([^*_\n]+?)(?<=\S)\3(?![\w*])")
MARKDOWN_LINE = re.compile(r"^[ \t]{0,3}(?:#{1,6}[ \t]+|(?:[-*•]|\d{1,2}[.)])[ \t]+)", re.MULTILINE)
ABBR = re.compile(r"(?<![\w.])(" + "|".join(re.escape(a) for a in sorted(ABBREVIATIONS, key=len, reverse=True)) + r")(?![\w])")
DATE_RANGE_DASH = re.compile(r"(?<=\w)\s?[–—]\s?(?=\w)")


def _money(m: re.Match) -> str:
    sign = _sign_word(m.group("sign")) or ("negative " if m.group("neg2") else "")
    approx = "approximately " if m.group("approx") else ""
    return approx + money_words(sign, m.group("whole"), m.group("cents"))


def _iso_date(m: re.Match) -> str:
    month = MONTH_NAMES[int(m.group("m")) - 1]
    return f"{month} {ordinal(int(m.group('d')))}, {year_words(int(m.group('y')))}"


def _month_date(m: re.Match) -> str:
    day = int(m.group("day"))
    if not 1 <= day <= 31:
        return m.group(0)  # "Nov 45" is not a date; leave it as typed
    month = MONTHS[m.group("month").lower()]
    out = f"{month} {ordinal(day)}"
    if m.group("year"):
        out += f", {year_words(int(m.group('year')))}"
    return out


def _percent(m: re.Match) -> str:
    words = _sign_word(m.group("sign")) + cardinal(int(m.group("whole")))
    if m.group("frac"):
        words += " point " + digits(m.group("frac"))
    words += " percent"
    if m.group("per"):
        unit = m.group("per").strip(" /")
        words += " per " + ("year" if unit.startswith("y") else "month")
    return words


def normalize_for_speech(text: str) -> str:
    """The text the speech engine should read for `text`. The visible answer is not changed."""
    s = text.replace("\r\n", "\n")
    # Markdown that may have survived: emphasis markers, list bullets, heading hashes, code ticks.
    s = MARKDOWN_LINE.sub("", s)
    for _ in range(2):  # nested **bold *italic***
        s = MARKDOWN_EMPHASIS.sub(lambda m: m.group(2) or m.group(4), s)
    s = s.replace("`", "")
    # Values before abbreviations, so "24.99% APR" becomes words in order.
    s = ISO_DATE.sub(_iso_date, s)
    s = MONTH_DATE.sub(_month_date, s)
    s = MONEY.sub(_money, s)
    s = PERCENT.sub(_percent, s)
    s = ABBR.sub(lambda m: ABBREVIATIONS[m.group(1)], s)
    s = DATE_RANGE_DASH.sub(" to ", s)  # "October 24th–November 6th" -> "... to ..."
    s = s.replace("≈", "approximately ").replace("−", "minus ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" +([,.;:)])", r"\1", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()
