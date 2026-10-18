"""Short definitions the assistant may use, matched to how THIS app calculates things.

The ids mirror frontend/src/content/concepts.ts so the same concept names can be
cross-referenced; keep the two in step when editing.
"""

GLOSSARY: dict[str, str] = {
    "apr": "Yearly interest rate (APR): the yearly price of borrowing, as a percent. This app's illustration "
           "charges APR / 365 on everything owed each day, starting the day after the purchase, with no grace "
           "period; real cards can work differently.",
    "interest_vs_fee": "Interest grows with how much you owe and for how long. A fee is a fixed dollar amount "
                       "that doesn't change with time. Here, credit adds interest; installments can add one "
                       "fixed fee the user entered.",
    "repayment": "Planned monthly repayment: the amount the user chose to pay each month. It is their plan, "
                 "not a card company's minimum required payment. Paying more clears the debt sooner with less "
                 "interest; a payment smaller than the interest added means the debt doesn't go down.",
    "installments": "Installments: a made-up fixed-payment offer for comparison. Real plans set their own "
                    "terms. The first payment is on the purchase date; the last payment absorbs leftover cents.",
    "fees": "Extra fee: a fixed amount added once to the total and split across the installment payments. "
            "It is not interest and doesn't grow over time.",
    "remaining_debt": "Still owed: money promised for later. It hasn't left checking yet but isn't free to "
                      "spend. For a card it includes interest added so far. Measured on the same date for every "
                      "option.",
    "cushion": "Cushion: the least the user wants to keep in checking for surprises. Staying above it only "
               "means checking stays above that number in this window; it does not make a purchase safe or "
               "affordable.",
}
