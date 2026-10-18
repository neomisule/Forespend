import { useMemo, useState } from 'react'
import { TermHelp } from '../components/TermHelp'
import type { ConceptId } from '../content/concepts'
import './game.css'

/** What a lesson hands to the calendar's purchase form ("Try this in your calendar"). */
export interface LessonPreset {
  label: string
  amount: string // "600.00"
  apr: string // "24"
  monthlyPayment: string // "100.00"
}

/** What an investing lesson hands to the Investing simulator ("Try this plan in the Investing simulator"). */
export interface InvestingPreset {
  contribution: string // "25.00"
  frequency: 'weekly' | 'biweekly' | 'monthly'
  years: number
}

// Toolkit terms that the calendar / simulator also explain, by the shared concept id.
const CONCEPT_FOR_TERM: Record<string, ConceptId> = {
  APR: 'apr',
  'Minimum payment': 'repayment',
  Interest: 'interest_vs_fee',
  Principal: 'remaining_debt',
  Fee: 'expense_ratio',
  'Expense ratio': 'expense_ratio',
  Compounding: 'compounding',
}

type Lesson = 'credit' | 'investing'
type CreditPlan = 'full' | 'fixed' | 'minimum'
type Fund = 'broad' | 'sector'

const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

function creditCost(plan: CreditPlan, apr: number, annualFee: number) {
  const purchase = 600
  if (plan === 'full') return { months: 1, interest: 0, total: purchase + annualFee - 6 }

  let balance = purchase
  let interest = 0
  let months = 0
  while (balance > 0.01 && months < 240) {
    const monthlyInterest = balance * (apr / 100 / 12)
    interest += monthlyInterest
    balance += monthlyInterest
    const payment =
      plan === 'fixed'
        ? Math.min(100, balance)
        : Math.min(Math.max(30, balance * 0.03), balance)
    balance -= payment
    months += 1
  }
  return { months, interest, total: purchase + annualFee + interest - 6 }
}

function investmentValue(contribution: number, years: number, rate: number, fee: number) {
  const periods = years * 26
  const periodicRate = (rate - fee) / 100 / 26
  if (Math.abs(periodicRate) < 0.000001) return contribution * periods
  return contribution * ((Math.pow(1 + periodicRate, periods) - 1) / periodicRate)
}

const stepNames = ['Meet the challenge', 'Make a prediction', 'Try the simulator', 'Quick check']

function GameLearningApp({
  onTryInCalendar,
  onTryInvesting,
}: { onTryInCalendar?: (preset: LessonPreset) => void; onTryInvesting?: (preset: InvestingPreset) => void } = {}) {
  const [lesson, setLesson] = useState<Lesson>('credit')
  const [creditStep, setCreditStep] = useState(0)
  const [investStep, setInvestStep] = useState(0)
  const [creditLevel, setCreditLevel] = useState(1)
  const [investLevel, setInvestLevel] = useState(1)
  const [completed, setCompleted] = useState<string[]>([])

  const step = lesson === 'credit' ? creditStep : investStep
  const level = lesson === 'credit' ? creditLevel : investLevel
  const currentMission = `${lesson}-${level}`
  const xp = (completed.length * 100) + (step * 25)

  function finishLesson() {
    setCompleted((current) =>
      current.includes(currentMission) ? current : [...current, currentMission],
    )
  }

  function changeLesson(nextLesson: Lesson) {
    setLesson(nextLesson)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function changeLevel(nextLevel: number) {
    if (lesson === 'credit') {
      setCreditLevel(nextLevel)
      setCreditStep(0)
    } else {
      setInvestLevel(nextLevel)
      setInvestStep(0)
    }
    window.scrollTo({ top: 260, behavior: 'smooth' })
  }

  function nextLevel() {
    if (level < 3) {
      changeLevel(level + 1)
    } else {
      changeLesson(lesson === 'credit' ? 'investing' : 'credit')
    }
  }

  return (
    <div className="game-app">
      <header className="game-header">
        <a href="#lesson" className="game-brand">
          <span aria-hidden="true">M</span>
          Money Lab
        </a>
        <div className="player-hud" id="player">
          <div className="hud-stat" aria-label={`${xp} experience points earned`}>
            <span aria-hidden="true">★</span><div><strong>{xp}</strong><small>TOTAL XP</small></div>
          </div>
          <div className="player-avatar" aria-label="Player profile">
            <span aria-hidden="true">M</span>
            <i aria-hidden="true" />
          </div>
        </div>
      </header>

      <main id="lesson">
        <section className="game-hero">
          <div className="world-label"><span aria-hidden="true">✦</span> WORLD 1 · MONEY FOUNDATIONS</div>
          <h1>Build your money instincts.</h1>
          <p>Complete two short missions. Predict first, test your idea, and learn from the result.</p>
          <div className="mission-picker" role="tablist" aria-label="Learning missions">
            <MissionButton
              active={lesson === 'credit'}
              complete={[1, 2, 3].every((item) => completed.includes(`credit-${item}`))}
              icon="▣"
              title="Credit card quest"
              subtitle="APR, dates & fees"
              onClick={() => changeLesson('credit')}
            />
            <MissionButton
              active={lesson === 'investing'}
              complete={[1, 2, 3].every((item) => completed.includes(`investing-${item}`))}
              icon="↗"
              title="Investing quest"
              subtitle="Funds, fees & risk"
              onClick={() => changeLesson('investing')}
            />
          </div>
        </section>

        <LevelPath
          lesson={lesson}
          selected={level}
          completed={completed}
          onSelect={changeLevel}
        />

        <div className="quest-map" id="progress">
          <div className="map-heading">
            <span>QUEST MAP</span>
            <small>LEVEL {step + 1} OF 4</small>
          </div>
          <nav className="quest-progress" aria-label="Lesson progress">
            {stepNames.map((name, index) => (
              <div
                key={name}
                className={index < step ? 'done' : index === step ? 'current' : ''}
                aria-current={index === step ? 'step' : undefined}
              >
                <span>{index < step ? '✓' : index + 1}</span>
                <small>{name}</small>
              </div>
            ))}
            <i style={{ width: `${step * 25}%` }} aria-hidden="true" />
          </nav>
        </div>

        {lesson === 'credit' ? (
          <CreditQuest
            courseLevel={creditLevel}
            step={creditStep}
            setStep={setCreditStep}
            completed={completed.includes(currentMission)}
            finish={finishLesson}
            nextQuest={nextLevel}
            onTryInCalendar={onTryInCalendar}
          />
        ) : (
          <InvestingQuest
            courseLevel={investLevel}
            step={investStep}
            setStep={setInvestStep}
            completed={completed.includes(currentMission)}
            finish={finishLesson}
            nextQuest={nextLevel}
            onTryInvesting={onTryInvesting}
          />
        )}
      </main>

      <footer>
        Educational examples use simplified assumptions. Returns are not guaranteed, and this is not financial advice.
      </footer>
    </div>
  )
}

function CreditQuest({
  courseLevel,
  step,
  setStep,
  completed,
  finish,
  nextQuest,
  onTryInCalendar,
}: {
  courseLevel: number
  step: number
  setStep: (step: number) => void
  completed: boolean
  finish: () => void
  nextQuest: () => void
  onTryInCalendar?: (preset: LessonPreset) => void
}) {
  const [prediction, setPrediction] = useState<CreditPlan | null>(null)
  const [checkedPrediction, setCheckedPrediction] = useState(false)
  const [plan, setPlan] = useState<CreditPlan>('fixed')
  const [apr, setApr] = useState(24)
  const [fee, setFee] = useState(0)
  const [quiz, setQuiz] = useState<string | null>(null)
  const result = useMemo(() => creditCost(plan, apr, fee), [plan, apr, fee])

  if (courseLevel > 1) {
    return (
      <AdvancedScenario
        lesson="credit"
        level={courseLevel}
        step={step}
        setStep={setStep}
        completed={completed}
        finish={finish}
        nextLevel={nextQuest}
      />
    )
  }

  if (step === 0) {
    return (
      <QuestCard accent="green">
        <div className="story-layout">
          <div>
            <span className="level-tag">CREDIT QUEST · LEVEL 1</span>
            <h2>Maya needs a laptop for class.</h2>
            <p className="story-copy">
              It costs <strong>$600</strong>. She has a credit card offer, but does not know
              whether paying slowly will make the laptop cost more.
            </p>
            <div className="offer-card">
              <div><small>APR</small><strong>24%</strong></div>
              <div><small>Cash back</small><strong>1%</strong></div>
              <div><small>Annual fee</small><strong>$0</strong></div>
            </div>
          </div>
          <div className="learn-panel">
            <p className="panel-label">YOUR TOOLKIT</p>
            <Term title="APR" text="The yearly interest rate charged when a balance is carried." />
            <Term title="Statement closes · Oct 28" text="The card company totals the purchases in this billing cycle." />
            <Term title="Payment due · Nov 22" text="Pay at least the minimum by this day. Paying the full statement balance usually avoids purchase interest." />
            <Term title="Rewards" text="A small benefit. Here, 1% back on $600 is only $6." />
          </div>
        </div>
        <MissionGoal>Help Maya choose a payment strategy that keeps her total cost low.</MissionGoal>
        <NextButton onClick={() => setStep(1)}>I’m ready · predict the outcome</NextButton>
      </QuestCard>
    )
  }

  if (step === 1) {
    return (
      <QuestCard accent="green">
        <span className="level-tag">CREDIT QUEST · LEVEL 2</span>
        <h2>What do you think?</h2>
        <p className="question">Which option will make the $600 laptop cost the least overall?</p>
        <div className="answer-grid">
          <Answer
            selected={prediction === 'full'}
            title="Pay the statement in full"
            detail="One payment by Nov 22"
            onClick={() => { setPrediction('full'); setCheckedPrediction(false) }}
          />
          <Answer
            selected={prediction === 'fixed'}
            title="Pay $100 each month"
            detail="Keep paying until the balance is $0"
            onClick={() => { setPrediction('fixed'); setCheckedPrediction(false) }}
          />
          <Answer
            selected={prediction === 'minimum'}
            title="Pay the minimum"
            detail="Start around $30 each month"
            onClick={() => { setPrediction('minimum'); setCheckedPrediction(false) }}
          />
        </div>
        {!checkedPrediction ? (
          <NextButton disabled={!prediction} onClick={() => setCheckedPrediction(true)}>
            Lock in my prediction
          </NextButton>
        ) : (
          <Feedback correct={prediction === 'full'}>
            {prediction === 'full'
              ? 'Correct! Paying the full statement balance by the due date usually avoids purchase interest.'
              : 'Good guess. Smaller payments help this month, but a carried balance collects interest and raises the total cost.'}
          </Feedback>
        )}
        {checkedPrediction && <CreditPredictionVisual />}
        {checkedPrediction && (
          <NextButton onClick={() => { setPlan(prediction ?? 'full'); setStep(2) }}>
            +25 XP · open the simulator
          </NextButton>
        )}
      </QuestCard>
    )
  }

  if (step === 2) {
    return (
      <QuestCard accent="green">
        <span className="level-tag">CREDIT QUEST · LEVEL 3</span>
        <h2>Test the payment choices.</h2>
        <p className="question">Mission: get interest to $0 and keep the total below $600.</p>
        <div className="simulator-layout">
          <div className="controls">
            <label>
              Payment strategy
              <select value={plan} onChange={(event) => setPlan(event.target.value as CreditPlan)}>
                <option value="full">Pay statement in full</option>
                <option value="fixed">Pay $100 monthly</option>
                <option value="minimum">Pay minimum only</option>
              </select>
            </label>
            <label>
              <span>APR <strong>{apr}%</strong></span>
              <input type="range" min="15" max="32" value={apr} onChange={(event) => setApr(Number(event.target.value))} />
            </label>
            <label>
              Annual fee
              <select value={fee} onChange={(event) => setFee(Number(event.target.value))}>
                <option value="0">$0</option>
                <option value="95">$95</option>
              </select>
            </label>
          </div>
          <div className="score-board">
            <p>YOUR RESULT</p>
            <div><span>Payoff time</span><strong>{result.months} {result.months === 1 ? 'month' : 'months'}</strong></div>
            <div><span>Interest</span><strong>{formatMoney(result.interest)}</strong></div>
            <div className="big-result"><span>Total cost</span><strong>{formatMoney(result.total)}</strong></div>
            <div className={result.interest === 0 && result.total < 600 ? 'mission-pass' : 'mission-hint'}>
              {result.interest === 0 && result.total < 600
                ? '✓ Mission complete! The $6 reward lowers the cost without interest.'
                : 'Try paying in full with no annual fee.'}
            </div>
          </div>
        </div>
        {onTryInCalendar && (
          <div className="calendar-link">
            <button
              type="button"
              className="calendar-link-button"
              onClick={() =>
                onTryInCalendar({
                  label: 'Laptop',
                  amount: '600.00',
                  apr: String(apr),
                  monthlyPayment: plan === 'fixed' ? '100.00' : plan === 'minimum' ? '30.00' : '600.00',
                })
              }
            >
              Try this purchase in your calendar
            </button>
            <small>
              Fills the calendar’s purchase form with the $600 laptop, {apr}% APR and this payment plan, next to Nehal’s real
              bills and pay. The calendar’s illustration charges interest from the day after purchase (no grace period), so
              its totals differ from this lesson’s statement-date example.
            </small>
          </div>
        )}
        <NextButton
          disabled={result.interest !== 0 || result.total >= 600}
          onClick={() => setStep(3)}
        >
          +25 XP · take the quick check
        </NextButton>
      </QuestCard>
    )
  }

  return (
    <QuestCard accent="green">
      {!completed ? (
        <>
          <span className="level-tag">FINAL CHECK</span>
          <h2>One last decision.</h2>
          <p className="question">
            Maya pays only the minimum by the due date. Which statement is true?
          </p>
          <div className="answer-grid two">
            <Answer
              selected={quiz === 'wrong'}
              title="She will never pay interest"
              detail="The minimum payment prevents all interest"
              onClick={() => setQuiz('wrong')}
            />
            <Answer
              selected={quiz === 'right'}
              title="She is on time, but may pay interest"
              detail="The remaining balance carries into the next cycle"
              onClick={() => setQuiz('right')}
            />
          </div>
          {quiz && (
            <Feedback correct={quiz === 'right'}>
              {quiz === 'right'
                ? 'Exactly. “Minimum due” and “full statement balance” are not the same amount.'
                : 'Not quite. Paying the minimum avoids a late payment, but the unpaid balance can still collect interest.'}
            </Feedback>
          )}
          <NextButton disabled={quiz !== 'right'} onClick={finish}>
            Complete credit quest
          </NextButton>
        </>
      ) : (
        <QuestComplete
          icon="▣"
          title="Credit card quest complete!"
          learned="You can now connect APR, payment size, statement dates, due dates, fees, and rewards."
          onNext={nextQuest}
          nextLabel="Continue to credit level 2"
        />
      )}
    </QuestCard>
  )
}

function InvestingQuest({
  courseLevel,
  step,
  setStep,
  completed,
  finish,
  nextQuest,
  onTryInvesting,
}: {
  onTryInvesting?: (preset: InvestingPreset) => void
  courseLevel: number
  step: number
  setStep: (step: number) => void
  completed: boolean
  finish: () => void
  nextQuest: () => void
}) {
  const [prediction, setPrediction] = useState<Fund | null>(null)
  const [checkedPrediction, setCheckedPrediction] = useState(false)
  const [fund, setFund] = useState<Fund>('sector')
  const [contribution, setContribution] = useState(25)
  const [years, setYears] = useState(5)
  const [quiz, setQuiz] = useState<string | null>(null)
  const fee = fund === 'broad' ? 0.15 : 1.25
  const contributionTotal = contribution * 26 * years
  const adverse = investmentValue(contribution, years, -4, fee)
  const example = investmentValue(contribution, years, 6, fee)
  const strong = investmentValue(contribution, years, 10, fee)

  if (courseLevel > 1) {
    return (
      <AdvancedScenario
        lesson="investing"
        level={courseLevel}
        step={step}
        setStep={setStep}
        completed={completed}
        finish={finish}
        nextLevel={nextQuest}
      />
    )
  }

  if (step === 0) {
    return (
      <QuestCard accent="gold">
        <div className="story-layout">
          <div>
            <span className="level-tag">INVESTING QUEST · LEVEL 1</span>
            <h2>Jordan wants to start small.</h2>
            <p className="story-copy">
              They can set aside <strong>$25 from each paycheck</strong> for a future goal.
              They are choosing between two hypothetical funds.
            </p>
            <div className="fund-cards">
              <div><small>BROAD MARKET</small><strong>Hundreds of companies</strong><span>0.15% annual fee</span></div>
              <div><small>TECH SECTOR</small><strong>One industry</strong><span>1.25% annual fee</span></div>
            </div>
          </div>
          <div className="learn-panel gold">
            <p className="panel-label">YOUR TOOLKIT</p>
            <Term title="Fund" text="A basket that can hold many investments together." />
            <Term title="Diversification" text="Spreading money across investments. It reduces some risk but cannot prevent loss." />
            <Term title="Fee" text="A percentage removed over time, whether the investment rises or falls." />
            <Term title="Risk" text="The chance that your result differs from what you hoped—or that you lose money." />
          </div>
        </div>
        <MissionGoal>Help Jordan compare the funds without treating any return as guaranteed.</MissionGoal>
        <NextButton onClick={() => setStep(1)}>I’m ready · predict the outcome</NextButton>
      </QuestCard>
    )
  }

  if (step === 1) {
    return (
      <QuestCard accent="gold">
        <span className="level-tag">INVESTING QUEST · LEVEL 2</span>
        <h2>What do you think?</h2>
        <p className="question">Which fund is less dependent on the success of one industry?</p>
        <div className="answer-grid two">
          <Answer
            selected={prediction === 'broad'}
            title="Broad market fund"
            detail="Hundreds of companies · 0.15% fee"
            onClick={() => { setPrediction('broad'); setCheckedPrediction(false) }}
          />
          <Answer
            selected={prediction === 'sector'}
            title="Technology sector fund"
            detail="One industry · 1.25% fee"
            onClick={() => { setPrediction('sector'); setCheckedPrediction(false) }}
          />
        </div>
        {!checkedPrediction ? (
          <NextButton disabled={!prediction} onClick={() => setCheckedPrediction(true)}>
            Lock in my prediction
          </NextButton>
        ) : (
          <Feedback correct={prediction === 'broad'}>
            {prediction === 'broad'
              ? 'Correct! Holding many companies across industries provides more diversification.'
              : 'The technology fund spreads money across companies, but they share one industry. The broad fund is more diversified.'}
          </Feedback>
        )}
        {checkedPrediction && <InvestingPredictionVisual />}
        {checkedPrediction && (
          <NextButton onClick={() => { setFund(prediction ?? 'broad'); setStep(2) }}>
            +25 XP · open the simulator
          </NextButton>
        )}
      </QuestCard>
    )
  }

  if (step === 2) {
    return (
      <QuestCard accent="gold">
        <span className="level-tag">INVESTING QUEST · LEVEL 3</span>
        <h2>Explore a range, not a promise.</h2>
        <p className="question">Change the fund, contribution, and time. Notice that every result can vary.</p>
        <div className="simulator-layout">
          <div className="controls">
            <label>
              Hypothetical fund
              <select value={fund} onChange={(event) => setFund(event.target.value as Fund)}>
                <option value="broad">Broad market · 0.15% fee</option>
                <option value="sector">Technology sector · 1.25% fee</option>
              </select>
            </label>
            <label>
              <span>Each paycheck <strong>{formatMoney(contribution)}</strong></span>
              <input type="range" min="10" max="75" step="5" value={contribution} onChange={(event) => setContribution(Number(event.target.value))} />
            </label>
            <label>
              <span>Time invested <strong>{years} years</strong></span>
              <input type="range" min="1" max="15" value={years} onChange={(event) => setYears(Number(event.target.value))} />
            </label>
            <div className="fact-chip">Annual fund fee: <strong>{fee}%</strong></div>
            <div className="fact-chip">You contribute: <strong>{formatMoney(contributionTotal)}</strong></div>
          </div>
          <div className="score-board">
            <p>ILLUSTRATIVE RANGE</p>
            <Outcome label="Adverse · −4%" value={adverse} width={Math.max(14, adverse / strong * 100)} tone="gold" />
            <Outcome label="Example · 6%" value={example} width={example / strong * 100} />
            <Outcome label="Strong · 10%" value={strong} width={100} />
            <div className="mission-pass neutral">✓ You found the key idea: there is more than one possible outcome.</div>
            <small className="disclaimer">These rates are teaching assumptions, not predictions. Actual investments can lose value.</small>
          </div>
        </div>
        {onTryInvesting && (
          <div className="calendar-link">
            <button
              type="button"
              className="calendar-link-button"
              onClick={() => onTryInvesting({ contribution: contribution.toFixed(2), frequency: 'biweekly', years })}
            >
              Try this plan in the Investing simulator
            </button>
            <small>
              Opens the simulator with {formatMoney(contribution)} every 2 weeks (each paycheck) for {years} years, comparing the
              0.15% and 1.25% fee funds on real contribution dates, with the 6% example return and the −4% adverse scenario
              you can change. Returns there are assumptions too, not predictions.
            </small>
          </div>
        )}
        <NextButton onClick={() => setStep(3)}>+25 XP · take the quick check</NextButton>
      </QuestCard>
    )
  }

  return (
    <QuestCard accent="gold">
      {!completed ? (
        <>
          <span className="level-tag">FINAL CHECK</span>
          <h2>One last decision.</h2>
          <p className="question">What does diversification actually do?</p>
          <div className="answer-grid two">
            <Answer
              selected={quiz === 'wrong'}
              title="It guarantees a profit"
              detail="A diversified fund cannot lose money"
              onClick={() => setQuiz('wrong')}
            />
            <Answer
              selected={quiz === 'right'}
              title="It spreads some risk"
              detail="Loss is still possible"
              onClick={() => setQuiz('right')}
            />
          </div>
          {quiz && (
            <Feedback correct={quiz === 'right'}>
              {quiz === 'right'
                ? 'Exactly. Diversification reduces dependence on one investment, but it cannot remove market risk.'
                : 'Not quite. Diversification can reduce some risk, but no fund can guarantee a profit.'}
            </Feedback>
          )}
          <NextButton disabled={quiz !== 'right'} onClick={finish}>
            Complete investing quest
          </NextButton>
        </>
      ) : (
        <QuestComplete
          icon="↗"
          title="Investing quest complete!"
          learned="You can now compare funds using diversification, fees, risk, time, and a range of possible outcomes."
          onNext={nextQuest}
          nextLabel="Continue to investing level 2"
        />
      )}
    </QuestCard>
  )
}

const levelDetails = {
  credit: [
    ['Card basics', 'Easy', 'APR, rewards and important dates'],
    ['Payment pressure', 'Medium', 'Minimum payments and interest'],
    ['Offer decoder', 'Hard', 'Compare rewards, fees and borrowing'],
  ],
  investing: [
    ['Fund basics', 'Easy', 'Funds, diversification and risk'],
    ['The fee effect', 'Medium', 'See how fees compound over time'],
    ['Market drop', 'Hard', 'Risk, losses and time horizons'],
  ],
} as const

function LevelPath({
  lesson,
  selected,
  completed,
  onSelect,
}: {
  lesson: Lesson
  selected: number
  completed: string[]
  onSelect: (level: number) => void
}) {
  return (
    <section className="level-path" aria-labelledby="level-path-title">
      <div className="level-path-heading">
        <div>
          <span>CHOOSE YOUR CHALLENGE</span>
          <h2 id="level-path-title">Level up one decision at a time.</h2>
        </div>
        <small>Easy → difficult</small>
      </div>
      <div className="level-cards">
        {levelDetails[lesson].map(([title, difficulty, description], index) => {
          const level = index + 1
          const isComplete = completed.includes(`${lesson}-${level}`)
          return (
            <button
              key={title}
              className={selected === level ? 'level-card selected' : 'level-card'}
              onClick={() => onSelect(level)}
              aria-pressed={selected === level}
            >
              <span className="level-number">{isComplete ? '✓' : level}</span>
              <span className="level-copy">
                <small className={`difficulty difficulty-${level}`}>{difficulty}</small>
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
              <i aria-hidden="true">{selected === level ? 'PLAYING' : isComplete ? 'REPLAY' : 'PLAY'}</i>
            </button>
          )
        })}
      </div>
    </section>
  )
}

type AdvancedConfig = {
  title: string
  story: string
  goal: string
  terms: [string, string][]
  question: string
  answers: [string, string, boolean][]
  sliderLabel: string
  sliderMin: number
  sliderMax: number
  sliderStep: number
  sliderDefault: number
  quiz: string
  quizAnswers: [string, string, boolean][]
}

const advancedConfigs: Record<string, AdvancedConfig> = {
  'credit-2': {
    title: 'The minimum-payment trap',
    story: 'Maya has a $600 balance at 24% APR. She can put between $30 and $150 toward it each month.',
    goal: 'Find a monthly payment that clears the balance faster and reduces interest.',
    terms: [
      ['Principal', 'The amount still owed before new interest.'],
      ['Minimum payment', 'The smallest required payment—not the cheapest repayment plan.'],
      ['Interest', 'The cost added for carrying the unpaid balance.'],
      ['Payoff time', 'How long repeated payments take to bring the balance to $0.'],
    ],
    question: 'Which choice usually reduces total interest the most?',
    answers: [
      ['Pay only the minimum', 'Keeps this month’s payment small', false],
      ['Pay the largest affordable amount', 'Reduces the balance sooner', true],
    ],
    sliderLabel: 'Monthly payment',
    sliderMin: 30,
    sliderMax: 150,
    sliderStep: 10,
    sliderDefault: 30,
    quiz: 'Why can minimum payments become expensive?',
    quizAnswers: [
      ['They keep a balance around longer', 'Interest has more time to accumulate', true],
      ['They always include a late fee', 'An on-time minimum is not late', false],
    ],
  },
  'credit-3': {
    title: 'Decode two card offers',
    story: 'Card A has no annual fee and 1% cash back. Card B has a $95 annual fee and 3% cash back.',
    goal: 'Compare rewards after fees instead of choosing the largest percentage.',
    terms: [
      ['Annual fee', 'A charge paid each year for keeping the card.'],
      ['Reward rate', 'The percentage returned on eligible spending.'],
      ['Net reward', 'Rewards earned minus the annual fee.'],
      ['Break-even point', 'The spending level where a larger reward finally offsets its fee.'],
    ],
    question: 'At $1,200 of annual spending, which offer has better net rewards?',
    answers: [
      ['Card A · 1% and no fee', '$12 reward and no annual fee', true],
      ['Card B · 3% and $95 fee', '$36 reward before the fee', false],
    ],
    sliderLabel: 'Annual card spending',
    sliderMin: 500,
    sliderMax: 6000,
    sliderStep: 500,
    sliderDefault: 1200,
    quiz: 'What matters more than rewards when a balance is carried?',
    quizAnswers: [
      ['APR and interest cost', 'Interest can exceed the rewards', true],
      ['The color of the card', 'Design does not change borrowing cost', false],
    ],
  },
  'investing-2': {
    title: 'The quiet effect of fees',
    story: 'Jordan invests $25 every payday. Two hypothetical funds earn the same return before fees: one charges 0.15%, the other 1.25%.',
    goal: 'See how a small annual percentage can change a long-term result.',
    terms: [
      ['Expense ratio', 'An annual percentage used to cover a fund’s operating costs.'],
      ['Compounding', 'Returns can build on earlier returns over time.'],
      ['Net return', 'The return left after fees are removed.'],
      ['Time horizon', 'How long the money is expected to stay invested.'],
    ],
    question: 'If everything else is equal, which fund leaves more money invested?',
    answers: [
      ['The 0.15% fee fund', 'Less is removed each year', true],
      ['The 1.25% fee fund', 'A higher fee does not create a higher return', false],
    ],
    sliderLabel: 'Years invested',
    sliderMin: 5,
    sliderMax: 30,
    sliderStep: 5,
    sliderDefault: 10,
    quiz: 'When does a fund charge its expense ratio?',
    quizAnswers: [
      ['Over time, even in a losing year', 'Fees are not limited to profitable years', true],
      ['Only after a guaranteed profit', 'Investment profits are never guaranteed', false],
    ],
  },
  'investing-3': {
    title: 'Navigate a market drop',
    story: 'Jordan has $4,000 invested for a goal eight years away. The market falls, and the account value drops.',
    goal: 'Understand loss, risk tolerance, diversification, and why the time horizon matters.',
    terms: [
      ['Volatility', 'How sharply an investment value moves up and down.'],
      ['Loss', 'A decline from the amount previously held.'],
      ['Risk tolerance', 'How much uncertainty and loss a person can handle.'],
      ['Time horizon', 'Money needed soon generally cannot wait as long for a possible recovery.'],
    ],
    question: 'Does diversification guarantee Jordan will avoid a market loss?',
    answers: [
      ['No, diversified funds can still fall', 'Diversification reduces some risks, not all risk', true],
      ['Yes, many holdings guarantee safety', 'More holdings cannot guarantee a positive result', false],
    ],
    sliderLabel: 'Market decline',
    sliderMin: 5,
    sliderMax: 40,
    sliderStep: 5,
    sliderDefault: 20,
    quiz: 'Who generally has less room for investment risk?',
    quizAnswers: [
      ['Someone who needs the money next year', 'There is less time to wait through a decline', true],
      ['Someone with a distant, flexible goal', 'More time does not remove risk, but provides flexibility', false],
    ],
  },
}

function AdvancedScenario({
  lesson,
  level,
  step,
  setStep,
  completed,
  finish,
  nextLevel,
}: {
  lesson: Lesson
  level: number
  step: number
  setStep: (step: number) => void
  completed: boolean
  finish: () => void
  nextLevel: () => void
}) {
  const config = advancedConfigs[`${lesson}-${level}`]
  const [prediction, setPrediction] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [slider, setSlider] = useState(config.sliderDefault)
  const [quiz, setQuiz] = useState<number | null>(null)
  const accent = lesson === 'credit' ? 'green' : 'gold'

  if (step === 0) {
    return (
      <QuestCard accent={accent}>
        <div className="story-layout">
          <div>
            <span className="level-tag">{lesson.toUpperCase()} QUEST · LEVEL {level}</span>
            <h2>{config.title}</h2>
            <p className="story-copy">{config.story}</p>
            <MissionGoal>{config.goal}</MissionGoal>
          </div>
          <div className={lesson === 'credit' ? 'learn-panel' : 'learn-panel gold'}>
            <p className="panel-label">NEW SKILLS</p>
            {config.terms.map(([title, text]) => <Term key={title} title={title} text={text} />)}
          </div>
        </div>
        <NextButton onClick={() => setStep(1)}>Start this challenge</NextButton>
      </QuestCard>
    )
  }

  if (step === 1) {
    const correct = prediction !== null && config.answers[prediction][2]
    return (
      <QuestCard accent={accent}>
        <span className="level-tag">PREDICTION ROUND</span>
        <h2>Choose before you calculate.</h2>
        <p className="question">{config.question}</p>
        <div className="answer-grid two">
          {config.answers.map(([title, detail], index) => (
            <Answer
              key={title}
              selected={prediction === index}
              title={title}
              detail={detail}
              onClick={() => { setPrediction(index); setChecked(false) }}
            />
          ))}
        </div>
        {!checked ? (
          <NextButton disabled={prediction === null} onClick={() => setChecked(true)}>Lock in prediction</NextButton>
        ) : (
          <>
            <Feedback correct={correct}>
              {correct
                ? 'You found the stronger choice. Now use the simulator to see how the numbers support it.'
                : 'That choice is understandable, but one hidden cost or risk changes the result. The simulator will make it visible.'}
            </Feedback>
            <NextButton onClick={() => setStep(2)}>+25 XP · test the numbers</NextButton>
          </>
        )}
      </QuestCard>
    )
  }

  if (step === 2) {
    return (
      <QuestCard accent={accent}>
        <span className="level-tag">SIMULATION ROUND</span>
        <h2>Move the control. Watch the trade-off.</h2>
        <AdvancedSimulation lesson={lesson} level={level} value={slider} config={config} onChange={setSlider} />
        <NextButton onClick={() => setStep(3)}>+25 XP · final check</NextButton>
      </QuestCard>
    )
  }

  if (!completed) {
    const correct = quiz !== null && config.quizAnswers[quiz][2]
    return (
      <QuestCard accent={accent}>
        <span className="level-tag">LEVEL {level} BOSS CHECK</span>
        <h2>Use what you learned.</h2>
        <p className="question">{config.quiz}</p>
        <div className="answer-grid two">
          {config.quizAnswers.map(([title, detail], index) => (
            <Answer key={title} selected={quiz === index} title={title} detail={detail} onClick={() => setQuiz(index)} />
          ))}
        </div>
        {quiz !== null && (
          <Feedback correct={correct}>
            {correct ? 'Correct. You can connect this idea to a real financial decision.' : 'Review the explanation and try the other choice.'}
          </Feedback>
        )}
        <NextButton disabled={!correct} onClick={finish}>Complete level {level}</NextButton>
      </QuestCard>
    )
  }

  return (
    <QuestCard accent={accent}>
      <QuestComplete
        icon={lesson === 'credit' ? '▣' : '↗'}
        title={`Level ${level} complete!`}
        learned={`You mastered ${config.title.toLowerCase()} and unlocked the next financial challenge.`}
        onNext={nextLevel}
        nextLabel={level < 3 ? `Continue to level ${level + 1}` : `Explore ${lesson === 'credit' ? 'investing' : 'credit'} quests`}
      />
    </QuestCard>
  )
}

function AdvancedSimulation({
  lesson,
  level,
  value,
  config,
  onChange,
}: {
  lesson: Lesson
  level: number
  value: number
  config: AdvancedConfig
  onChange: (value: number) => void
}) {
  let content: React.ReactNode

  if (lesson === 'credit' && level === 2) {
    const result = creditWithPayment(value)
    content = (
      <ComparisonResult
        firstLabel="Interest paid"
        firstValue={formatMoney(result.interest)}
        secondLabel="Payoff time"
        secondValue={`${result.months} months`}
        insight={value >= 100 ? 'Larger payments reduce both payoff time and total interest.' : 'A smaller payment leaves more balance for interest to act on.'}
        percent={Math.min(100, result.months / 30 * 100)}
      />
    )
  } else if (lesson === 'credit') {
    const cardA = value * .01
    const cardB = value * .03 - 95
    content = (
      <ComparisonResult
        firstLabel="Card A net rewards"
        firstValue={formatMoney(cardA)}
        secondLabel="Card B net rewards"
        secondValue={formatMoney(cardB)}
        insight={cardB > cardA ? 'At this spending level, Card B finally offsets its $95 fee.' : 'Card A keeps more value because Card B’s fee exceeds its extra rewards.'}
        percent={Math.min(100, value / 6000 * 100)}
      />
    )
  } else if (level === 2) {
    const lowFee = investmentValue(25, value, 6, .15)
    const highFee = investmentValue(25, value, 6, 1.25)
    content = (
      <ComparisonResult
        firstLabel="0.15% fee illustration"
        firstValue={formatMoney(lowFee)}
        secondLabel="1.25% fee illustration"
        secondValue={formatMoney(highFee)}
        insight={`The illustrated gap is ${formatMoney(lowFee - highFee)} after ${value} years. Returns are not guaranteed.`}
        percent={value / 30 * 100}
      />
    )
  } else {
    const remaining = 4000 * (1 - value / 100)
    content = (
      <ComparisonResult
        firstLabel="Starting value"
        firstValue="$4,000"
        secondLabel="Value after decline"
        secondValue={formatMoney(remaining)}
        insight={`A ${value}% decline removes ${formatMoney(4000 - remaining)}. Diversification cannot guarantee against a market-wide loss.`}
        percent={100 - value}
      />
    )
  }

  return (
    <div className="advanced-simulator">
      <label>
        <span>{config.sliderLabel}<strong>{lesson === 'investing' && level === 2 ? `${value} years` : lesson === 'investing' ? `${value}%` : formatMoney(value)}</strong></span>
        <input
          type="range"
          min={config.sliderMin}
          max={config.sliderMax}
          step={config.sliderStep}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      {content}
    </div>
  )
}

function ComparisonResult({
  firstLabel,
  firstValue,
  secondLabel,
  secondValue,
  insight,
  percent,
}: {
  firstLabel: string
  firstValue: string
  secondLabel: string
  secondValue: string
  insight: string
  percent: number
}) {
  return (
    <div className="advanced-result" aria-live="polite">
      <div><span>{firstLabel}</span><strong>{firstValue}</strong></div>
      <div><span>{secondLabel}</span><strong>{secondValue}</strong></div>
      <div className="result-meter"><i style={{ width: `${percent}%` }} /></div>
      <p>{insight}</p>
    </div>
  )
}

function creditWithPayment(payment: number) {
  let balance = 600
  let interest = 0
  let months = 0
  while (balance > .01 && months < 120) {
    const monthlyInterest = balance * .24 / 12
    interest += monthlyInterest
    balance += monthlyInterest
    balance -= Math.min(payment, balance)
    months += 1
  }
  return { interest, months }
}

function MissionButton({
  active,
  complete,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean
  complete: boolean
  icon: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      className={active ? 'mission active' : 'mission'}
      onClick={onClick}
    >
      <span className="mission-icon" aria-hidden="true">{complete ? '✓' : icon}</span>
      <span><strong>{title}</strong><small>{complete ? 'Quest complete' : subtitle}</small></span>
    </button>
  )
}

function QuestCard({ children, accent }: { children: React.ReactNode; accent: 'green' | 'gold' }) {
  return <section className={`quest-card ${accent}`}>{children}</section>
}

function Term({ title, text }: { title: string; text: string }) {
  const concept = CONCEPT_FOR_TERM[title] // same explanation the calendar uses, when the term matches
  return (
    <div className="term">
      <span aria-hidden="true">★</span>
      <div>
        <strong>{title}</strong>
        {concept && <TermHelp concept={concept} label="How the app uses this" />}
        <p>{text}</p>
      </div>
    </div>
  )
}

function MissionGoal({ children }: { children: React.ReactNode }) {
  return <div className="mission-goal"><span aria-hidden="true">◎</span><p><strong>YOUR MISSION</strong>{children}</p></div>
}

function NextButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return <button className="next-button" onClick={onClick} disabled={disabled}>{children}<span aria-hidden="true">→</span></button>
}

function Answer({
  selected,
  title,
  detail,
  onClick,
}: {
  selected: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button className={selected ? 'answer selected' : 'answer'} onClick={onClick}>
      <span className="radio" aria-hidden="true">{selected ? '●' : ''}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </button>
  )
}

function Feedback({ correct, children }: { correct: boolean; children: React.ReactNode }) {
  return (
    <div className={correct ? 'feedback correct' : 'feedback try-again'} role="status">
      <span aria-hidden="true">{correct ? '✓' : '↻'}</span>
      <p><strong>{correct ? 'Nice work!' : 'Let’s unpack that.'}</strong>{children}</p>
    </div>
  )
}

function Outcome({
  label,
  value,
  width,
  tone = 'green',
}: {
  label: string
  value: number
  width: number
  tone?: 'green' | 'gold'
}) {
  return (
    <div className="game-outcome">
      <span>{label}</span><strong>{formatMoney(value)}</strong>
      <i className={tone} style={{ width: `${width}%` }} />
    </div>
  )
}

function CreditPredictionVisual() {
  const full = creditCost('full', 24, 0)
  const fixed = creditCost('fixed', 24, 0)
  const minimum = creditCost('minimum', 24, 0)
  const choices = [
    { label: 'Pay in full', result: full, tone: 'best' },
    { label: '$100 monthly', result: fixed, tone: 'middle' },
    { label: 'Minimum only', result: minimum, tone: 'high' },
  ]
  const maximum = Math.max(...choices.map((choice) => choice.result.total))

  return (
    <div className="prediction-visual" aria-label="Visual comparison of credit payment choices">
      <div className="visual-title">
        <span aria-hidden="true">◎</span>
        <div><strong>See why</strong><small>Interest grows when a balance stays unpaid.</small></div>
      </div>
      <div className="cost-visual">
        {choices.map((choice) => (
          <div className={`cost-choice ${choice.tone}`} key={choice.label}>
            <div className="cost-label">
              <span>{choice.label}</span>
              <strong>{formatMoney(choice.result.total)}</strong>
            </div>
            <div className="cost-track">
              <i style={{ width: `${(choice.result.total / maximum) * 100}%` }} />
              <b>{formatMoney(choice.result.interest)} interest</b>
            </div>
            <small>{choice.result.months} {choice.result.months === 1 ? 'month' : 'months'} to repay</small>
          </div>
        ))}
      </div>
      <div className="date-journey">
        <div><i>1</i><span><strong>Oct 24</strong>Buy laptop</span></div>
        <b aria-hidden="true" />
        <div><i>2</i><span><strong>Oct 28</strong>Statement closes</span></div>
        <b aria-hidden="true" />
        <div><i>3</i><span><strong>Nov 22</strong>Payment is due</span></div>
      </div>
      <p className="visual-caption">
        The $6 reward is the same for every choice. The difference is how long interest has
        time to grow. Estimates assume no new purchases or late payments.
      </p>
    </div>
  )
}

function InvestingPredictionVisual() {
  const broadDots = ['health', 'tech', 'energy', 'retail', 'finance', 'health', 'energy', 'tech', 'retail', 'finance', 'health', 'energy']
  const techDots = Array.from({ length: 12 }, () => 'tech')

  return (
    <div className="prediction-visual" aria-label="Visual comparison of fund diversification and fees">
      <div className="visual-title">
        <span aria-hidden="true">◎</span>
        <div><strong>See why</strong><small>What is inside the basket changes its concentration.</small></div>
      </div>
      <div className="basket-comparison">
        <FundBasket
          title="Broad market fund"
          subtitle="Many industries"
          fee="0.15% fee"
          dots={broadDots}
          tag="More diversified"
          recommended
        />
        <FundBasket
          title="Technology sector fund"
          subtitle="One industry"
          fee="1.25% fee"
          dots={techDots}
          tag="More concentrated"
        />
      </div>
      <div className="diversification-key" aria-label="Industry color key">
        <span><i className="health" />Health</span>
        <span><i className="tech" />Technology</span>
        <span><i className="energy" />Energy</span>
        <span><i className="retail" />Retail</span>
        <span><i className="finance" />Finance</span>
      </div>
      <p className="visual-caption">
        If technology falls, every dot in the sector fund faces the same industry pressure.
        Different colors spread that specific risk—but diversification cannot prevent all losses.
      </p>
    </div>
  )
}

function FundBasket({
  title,
  subtitle,
  fee,
  dots,
  tag,
  recommended = false,
}: {
  title: string
  subtitle: string
  fee: string
  dots: string[]
  tag: string
  recommended?: boolean
}) {
  return (
    <div className={recommended ? 'fund-basket recommended' : 'fund-basket'}>
      <div className="basket-heading">
        <div><strong>{title}</strong><small>{subtitle}</small></div>
        <span>{fee}</span>
      </div>
      <div className="dot-basket" aria-hidden="true">
        {dots.map((dot, index) => <i className={dot} key={`${dot}-${index}`} />)}
      </div>
      <b>{tag}</b>
    </div>
  )
}

function QuestComplete({
  icon,
  title,
  learned,
  onNext,
  nextLabel,
}: {
  icon: string
  title: string
  learned: string
  onNext: () => void
  nextLabel: string
}) {
  return (
    <div className="quest-complete">
      <div className="badge-burst" aria-hidden="true"><span>{icon}</span></div>
      <p className="level-tag">+100 XP EARNED</p>
      <h2>{title}</h2>
      <p>{learned}</p>
      <div className="earned-badge">★ Money decision explorer</div>
      <NextButton onClick={onNext}>{nextLabel}</NextButton>
    </div>
  )
}

export default GameLearningApp
