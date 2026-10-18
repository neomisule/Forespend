// Plain-language explanations of money terms, kept apart from any UI so they
// can be reused (for example by Learn lessons later).
//
// Each concept has a STABLE id. Don't rename ids; other code may link to them.
// `model` describes how THIS app calculates it, so the explanation always
// matches the numbers on screen. `learnPath` is only set when a real Learn page
// exists; the help popover shows a "Learn more" link only then.

export type ConceptId =
  | "apr"
  | "interest_vs_fee"
  | "repayment"
  | "first_repayment"
  | "installments"
  | "fees"
  | "remaining_debt"
  | "cushion";

export interface Concept {
  id: ConceptId;
  term: string;
  meaning: string; // what it means in general
  model?: string; // how this app's illustration treats it
  learnPath?: string; // e.g. "/learn/apr" once that lesson exists
}

export const CONCEPTS: Record<ConceptId, Concept> = {
  apr: {
    id: "apr",
    term: "Yearly interest rate (APR)",
    meaning:
      "APR is the yearly price of borrowing, written as a percent. The longer you owe money and the more you owe, the more interest you pay.",
    model:
      "Here we split the APR into a daily rate (APR ÷ 365) and charge it on what you owe every day, starting the day after you buy. Real cards can work differently, depending on their terms and when you pay.",
  },
  interest_vs_fee: {
    id: "interest_vs_fee",
    term: "Interest vs. fee",
    meaning:
      "Interest grows with how much you owe and for how long. A fee is a fixed dollar amount that doesn’t change with time.",
    model: "In this comparison, credit cards add interest; installments can add one fixed fee that you enter.",
  },
  repayment: {
    id: "repayment",
    term: "Amount you plan to repay each month",
    meaning:
      "The amount you choose to pay back each month. It is your plan, not the minimum payment a card company requires.",
    model:
      "Paying more each month pays the debt off sooner and adds less interest. If your payment is smaller than the interest added, the debt won’t go down, and we’ll tell you.",
  },
  first_repayment: {
    id: "first_repayment",
    term: "First repayment date",
    meaning: "The day your first card repayment leaves checking.",
    model:
      "Until then the purchase is debt: your checking balance doesn’t change, but interest is still added. Later repayments happen on the same day each month.",
  },
  installments: {
    id: "installments",
    term: "Installments",
    meaning: "Splitting a price into a set number of payments on fixed dates.",
    model:
      "This is a made-up offer for comparison. Real plans set their own number of payments, fees and rules. Here the first payment is on the purchase date, and the last payment absorbs any leftover cents.",
  },
  fees: {
    id: "fees",
    term: "Extra fee",
    meaning: "A fixed dollar amount added once to what you pay in total, for example a plan fee.",
    model: "Here the fee is added to the price and split across your payments. It is not interest: it doesn’t grow over time.",
  },
  remaining_debt: {
    id: "remaining_debt",
    term: "What you still owe",
    meaning:
      "Money you have promised to pay later. It hasn’t left your checking account yet, but it isn’t yours to spend.",
    model: "For a card this includes interest added so far. It is measured on the same date for every option.",
  },
  cushion: {
    id: "cushion",
    term: "Cushion",
    meaning: "The least you want to keep in checking for surprises, like a repair or a late paycheck.",
    model:
      "We compare it with each option’s lowest projected balance. Passing doesn’t make a purchase safe or affordable; it only means checking stays above your number in this window.",
  },
};
