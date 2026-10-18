"""Speech-text normalisation: what ElevenLabs is asked to read. Pure functions, no network."""
import pytest

from app.ai.speech_text import cardinal, normalize_for_speech, ordinal, year_words


@pytest.mark.parametrize("n,words", [
    (0, "zero"), (1, "one"), (12, "twelve"), (20, "twenty"), (24, "twenty-four"), (100, "one hundred"),
    (230, "two hundred thirty"), (605, "six hundred five"), (1200, "one thousand two hundred"),
    (1735, "one thousand seven hundred thirty-five"), (100000, "one hundred thousand"),
])
def test_cardinals(n, words):
    assert cardinal(n) == words


@pytest.mark.parametrize("n,words", [
    (1, "first"), (2, "second"), (3, "third"), (4, "fourth"), (5, "fifth"), (8, "eighth"), (9, "ninth"),
    (12, "twelfth"), (20, "twentieth"), (21, "twenty-first"), (24, "twenty-fourth"), (30, "thirtieth"), (31, "thirty-first"),
])
def test_ordinals(n, words):
    assert ordinal(n) == words


@pytest.mark.parametrize("y,words", [
    (2026, "twenty twenty-six"), (2027, "twenty twenty-seven"), (2010, "twenty ten"), (2005, "two thousand five"),
    (2000, "two thousand"), (1999, "nineteen ninety-nine"), (1907, "nineteen oh seven"), (1900, "nineteen hundred"),
])
def test_years(y, words):
    assert year_words(y) == words


@pytest.mark.parametrize("text,spoken", [
    # the user's examples
    ("Oct 24, 2026", "October twenty-fourth, twenty twenty-six"),
    ("Nov 1", "November first"),
    ("2026-11-06", "November sixth, twenty twenty-six"),
    ("$12.20", "twelve dollars and twenty cents"),
    ("$600.00", "six hundred dollars"),
    ("-$230.50", "negative two hundred thirty dollars and fifty cents"),
    ("24.99% APR", "twenty-four point nine nine percent annual percentage rate"),
    ("≈$170", "approximately one hundred seventy dollars"),
    # more money shapes
    ("$1,735.00", "one thousand seven hundred thirty-five dollars"),
    ("$605.34", "six hundred five dollars and thirty-four cents"),
    ("$0.50", "fifty cents"),
    ("$1.01", "one dollar and one cent"),
    ("$-430.00", "negative four hundred thirty dollars"),
    ("−$300.00", "negative three hundred dollars"),
    ("+$650", "plus six hundred fifty dollars"),
    ("$12.5", "twelve dollars and fifty cents"),
    # percentages
    ("-4%", "negative four percent"),
    ("6%/yr", "six percent per year"),
    ("0.15% fee", "zero point one five percent fee"),
    # dates in sentences and ranges
    ("Lowest checking between Oct 24–Nov 6.", "Lowest checking between October twenty-fourth to November sixth."),
    ("plan ends May 15, 2027.", "plan ends May fifteenth, twenty twenty-seven."),
    ("on Sept. 3rd", "on September third"),
    ("(lowest $170.00 on Nov 1, 2026).", "(lowest one hundred seventy dollars on November first, twenty twenty-six)."),
])
def test_examples(text, spoken):
    assert normalize_for_speech(text) == spoken


def test_contextual_matching_leaves_ordinary_text_alone():
    # Month abbreviations inside words or without a day number are not dates.
    assert normalize_for_speech("Doctor Octavia decided in October.") == "Doctor Octavia decided in October."
    assert normalize_for_speech("the Nov figures") == "the Nov figures"
    assert normalize_for_speech("in March 2027 and Dec 2026") == "in March 2027 and Dec 2026"  # month + year: ambiguous, kept
    assert normalize_for_speech("you may 5 times") == "you may 5 times"
    assert normalize_for_speech("Nov 45 is not a date") == "Nov 45 is not a date"
    # Only "$" makes money; other decimals and bare numbers are left for the engine.
    assert normalize_for_speech("4 payments over 1.5 years, 2027 budget") == "4 payments over 1.5 years, 2027 budget"
    assert normalize_for_speech("version 2.0 is out") == "version 2.0 is out"
    # Abbreviations only as whole words.
    assert normalize_for_speech("APRIL rent; the APR is 24.99%") == "APRIL rent; the annual percentage rate is twenty-four point nine nine percent"


def test_markdown_is_removed():
    text = "**Here's the trade-off.**\n\n- **Cash:** $600.00 now.\n- *Credit:* $0.00 now.\n### Note\n`x`"
    assert normalize_for_speech(text) == (
        "Here's the trade-off.\n\nCash: six hundred dollars now.\nCredit: zero dollars now.\nNote\nx"
    )


def test_real_answer_reads_as_words():
    text = ("Cash: $600.00 leaves checking on Oct 24, 2026 (lowest balance $170.00 on Nov 1, 2026). "
            "Credit: $605.34 owed on Nov 6, 2026 (includes $5.34 interest), 24.99% APR.")
    spoken = normalize_for_speech(text)
    assert spoken == (
        "Cash: six hundred dollars leaves checking on October twenty-fourth, twenty twenty-six "
        "(lowest balance one hundred seventy dollars on November first, twenty twenty-six). "
        "Credit: six hundred five dollars and thirty-four cents owed on November sixth, twenty twenty-six "
        "(includes five dollars and thirty-four cents interest), twenty-four point nine nine percent annual percentage rate."
    )
    assert not any(ch.isdigit() for ch in spoken)
