// An invented budget tracker (Tracker tab), laid out like the real one, for test_budget.js and
// test_budget_ui.js. Every name and figure is invented.
// ---- the tracker, laid out like the real one: person | shared (label, amount, account) | person ----
function tracker(opts) {
  opts = opts || {};
  const rows = [];
  const set = (r, c, v) => { while (rows.length <= r) rows.push([]); while (rows[r].length <= c) rows[r].push(''); rows[r][c] = v; };
  const B = 1, E = 4, I = 8;
  set(0, 0, '2026'); set(0, 11, 'WHAT IF');
  set(1, B, 'Pat'); set(1, E, 'Shared Expenses'); set(1, I, 'Sam');
  // Pat
  [['Monthly Income'], ['Gross Income', '$10,000.00'], ['401K Deductions ', '$1,000.00'], ['Federal Withholding ', '$1,500.00'], ['State Withholding', '$500.00'], [''],
   ['Net Income', '$7,200.00'], [''], ['Monthly Expenses'], ['Fixed Expenses'], ['Car Insurance - Pat', '$100.00'], ['Phone - Pat', '$50.00'],
   ['Nice to Have Expenses'], ['Gym', '$40.00'], ['Music', '$10.00']].forEach((x, k) => { set(2 + k, B, x[0]); if (x[1] != null) set(2 + k, B + 1, x[1]); });
  // Sam (numbers as the sheet's getValues gives them: plain numbers)
  [['Monthly Income'], ['Gross Income', 6000], ['401K Deductions ', 500], ['Federal Withholding ', 900], ['Federal MED/EE', ''], [''],
   ['Net Income', 4600], [''], ['Monthly Expenses'], ['Fixed Expenses'], ['Car Insurance - Sam', 80], ['Nice to Have Expenses'], ['Books', 20]]
    .forEach((x, k) => { set(2 + k, I, x[0]); if (x[1] != null) set(2 + k, I + 1, x[1]); });
  // shared
  const shared = opts.shared || [['Monthly Expenses'], ['Fixed Expenses', '', 'Account'], ['Rent (1st)', '$2,000.00', 'Joint'], ['Health Insurance - Medical', '$100.00', 'Pat'],
    ['Utilities - Electric (15th)', '$90.00', 'Joint'], ['Internet (13th)', '$60.00', 'Joint'], ['Family Plan Payment (12th)', '$200.00', 'Joint'], ['Family Plan Credit', '-$50.00', 'Joint'],
    ['Groceries', '$600.00', 'Sam'], ['Nice to Have Expenses'], ['Home Cleaning ', '$100.00', 'Pat'], ['Subscription - Stream', '$10.00', 'Sam'], ['Dog Walker', '$40.00', 'Joint'],
    [''], ['What If Scenarios'], ['New Rent Delta', '$500.00', 'Joint']];
  shared.forEach((x, k) => { set(2 + k, E, x[0]); if (x[1] != null) set(2 + k, E + 1, x[1]); if (x[2] != null) set(2 + k, E + 2, x[2]); });
  // the summary block
  const s = 40;
  set(s, B, 'Personal Savings Contribution '); set(s, B + 1, '$300.00'); set(s, E, 'Total Shared Expenses'); set(s, E + 1, '$3,150.00'); set(s, E + 2, '100%');
  set(s, I, 'Personal Savings Contribution '); set(s, I + 1, 200);
  set(s + 1, B, 'Shared Expense Contribution '); set(s + 1, B + 1, '$1,890.00'); set(s + 1, E, opts.pctLabel || "Pat's Contribution:"); set(s + 1, E + 1, '$1,890.00'); set(s + 1, E + 2, opts.split || '60%');
  set(s + 1, I, 'Shared Expense Contribution '); set(s + 1, I + 1, 1260);
  set(s + 2, B, 'Shared Savings Contribution '); set(s + 2, B + 1, '$600.00'); set(s + 2, E, "Sam's Contribution:"); set(s + 2, E + 1, '$1,260.00'); set(s + 2, E + 2, '40%');
  set(s + 2, I, 'Shared Savings Contribution '); set(s + 2, I + 1, 400);
  set(s + 3, B, 'Net Expenses'); set(s + 3, B + 1, '$2,990.00'); set(s + 3, E, 'Total Required Expenses'); set(s + 3, E + 1, opts.required || '$3,050.00');
  set(s + 3, I, 'Net Expenses'); set(s + 3, I + 1, 1960);
  set(s + 5, B, 'Disposable Income'); set(s + 5, B + 1, '$4,210.00'); set(s + 5, E, 'Total Shared Savings'); set(s + 5, E + 1, '$1,000.00');
  set(s + 5, I, 'Disposable Income'); set(s + 5, I + 1, 2640);
  set(s + 6, E + 2, 'Own Cards'); set(s + 6, E + 3, 'Correction');
  set(s + 7, E, "Pat's Transfer to AMEX Checking"); set(s + 7, E + 1, '$1,690.00'); set(s + 7, E + 2, '$200.00');
  set(s + 8, E, "Sam's Transfer to AMEX Checking"); set(s + 8, E + 1, '$650.00'); set(s + 8, E + 2, '$610.00');
  set(s + 10, E, "Pat's Transfer to AMEX Savings"); set(s + 10, E + 1, '$600.00');
  set(s + 11, E, "Sam's Transfer to AMEX Savings"); set(s + 11, E + 1, '$400.00');
  set(s + 13, E, 'Total Shared Net Income'); set(s + 13, E + 1, '$11,800.00');
  set(s + 15, B, 'Total 401K Contribution'); set(s + 15, E, 'Total Shared Disposable Income'); set(s + 15, E + 1, '$6,850.00');
  return rows;
}

module.exports = { tracker };
