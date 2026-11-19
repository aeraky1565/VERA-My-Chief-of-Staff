// An invented budget tracker (its Household Split tab), laid out like the real one, for the budget and
// bills tests. Every name and figure is invented. opts: { split, bills (extra bill rows), noBlank,
// payDeductions (extra paycheck rows), sharedSavings, psave }.
// ---- 1. Paychecks (per paycheck) · 2. Bills (a month) · 3. Split · 4–6 the sheet's own figures ----
function tracker(opts) {
  opts = opts || {};
  const rows = [];
  const add = r => rows.push(r);
  add(['Household split (invented figures)']); add(['Yellow cells are inputs.']); add([]);
  add(['1. Paychecks', 'Pat', 'Sam', 'Shared cost?']);
  add(['Pay cadence', 'Monthly', 'Monthly']);
  add(['Gross pay per paycheck', '$10,000.00', 6000]);
  add(['Pre-tax deductions']);
  add(['401(k)', '$1,000.00', 500, 'No']);
  add(['Health Insurance - Medical', '$100.00', '', 'Yes']);
  (opts.payDeductions || []).forEach(r => add(r));
  add(['After-tax deductions']);
  add(['Identity plan', '', '', 'No']);
  add(['Taxes per paycheck (worked out from the deposit)', '$2,000.00', 900]);
  add(['Net deposit per paycheck', '$6,900.00', 4600]);
  add(['Paychecks a year', '12', 12]);
  add(['Paychecks in a regular month', '1', 1]);
  add(['Take-home, regular month (everything below uses this)', '$6,900.00', 4600]);
  add(['Average month, for reference only', '$6,900.00', 4600]);
  add(['Extra paychecks a year (see section 6)', '-', '-']);
  add([]);
  add(['2. Bills (paid from take-home)', 'Monthly', 'Type', 'For', 'Paid by', 'Actual or set-aside', 'Category']);
  const bills = [
    ['Rent (1st)', '$2,000.00', 'Fixed', 'Shared', 'Joint', 'Actual', ''],
    ['Utilities - Electric (15th)', '$90.00', 'Fixed', 'Shared', 'Joint', 'Actual', ''],
    ['Internet (13th)', '$60.00', 'Fixed', 'Shared', 'Joint', 'Actual', ''],
    ['Family Plan Payment (12th)', '$200.00', 'Fixed', 'Shared', 'Joint', 'Actual', ''],
    ['Family Plan Credit', '-$50.00', 'Fixed', 'Shared', 'Joint', 'Actual', ''],
    ['Groceries', '$600.00', 'Fixed', 'Shared', 'Sam', 'Actual', ''],
    ['Home Cleaning', '$100.00', 'Nice to have', 'Shared', 'Pat', 'Actual', ''],
    ['Subscription - Stream', '$10.00', 'Nice to have', 'Shared', 'Sam', 'Actual', ''],
    ['Dog Walker', '$40.00', 'Nice to have', 'Shared', 'Joint', 'Actual', ''],
    ['Car Insurance - Pat', '$100.00', 'Fixed', 'Pat', 'Pat', 'Set-aside', 'Insurance'],
    ['Phone - Pat', '$50.00', 'Fixed', 'Pat', 'Pat', 'Actual', 'Utilities'],
    ['Gym', '$40.00', 'Nice to have', 'Pat', 'Pat', 'Actual', 'Health'],
    ['Music', '$10.00', 'Nice to have', 'Pat', 'Pat', 'Actual', 'Subscriptions'],
    ['Car Insurance - Sam', 80, 'Fixed', 'Sam', 'Sam', 'Actual', 'Insurance'],
    ['Books', 20, 'Nice to have', 'Sam', 'Sam', 'Actual', 'Subscriptions']].concat(opts.bills || []);
  bills.forEach(r => add(r));
  if (!opts.noBlank) { add([]); add([]); }
  add(['Total bills', '$3,350.00']);
  add([]);
  add(['3. Split', 'Pat', 'Sam', 'Total']);
  add(['Share of shared costs', opts.split || '60%', '40%', '100%']);
  add(['Shared expenses, your share', '$1,890.00', 1260, '$3,150.00']);
  add(['Less: shared costs taken from your paychecks', '$100.00', '-', '$100.00']);
  add(['Less: shared bills paid on your own card', '$100.00', 610, '$710.00']);
  add(['Transfer to Joint Checking', '$1,690.00', 650, '$2,340.00']);
  add(['Transfer to shared savings', '$600.00', 400, opts.sharedSavings || '$1,000.00']);
  add(['Personal bills', '$200.00', 100, '$300.00']);
  add(['Personal savings', opts.psave || '$300.00', 200, '$500.00']);
  add(['Left over each month', '$4,010.00', 2640, '$6,650.00']);
  add([]); add(['Checks']);
  add(['Settle-up built into the transfers (Pat to Sam)', '$286.00']);
  add(['Joint Checking: bills it pays minus transfers in (should be 0)', '$0.00']);
  add(['Bills missing Type, For or Paid by (should be 0)', '0']);
  add([]);
  add(['4. Summary', 'Pat', 'Sam', 'Total']);
  add(['Fixed', '$1,800.00', 1200, '$3,000.00']); add(['Variable', '$0.00', 0, '$0.00']); add(['Nice to have', '$90.00', 60, '$150.00']);
  add(['Take-home income (regular month)', '$6,900.00', 4600, '$11,500.00']);
  add(['Set-asides to keep in savings each month (by who pays the bill)', '$100.00', 0, '$100.00']);
  add([]);
  add(['5. Emergency fund', 'Pat', 'Sam', 'Total']);
  add(['Required shared expenses a month (fixed and variable)', '$1,800.00', 1200, '$3,000.00']);
  add([]);
  add(['6. Bonuses and extra paychecks (kept out of the monthly budget)', 'Pat', 'Sam', 'Total']);
  add(['Usually paid', 'March', 'June']); add(['Net bonus deposit', '', '', '-']); add(['Extra paychecks a year', '-', '-', '-']);
  add(['Share to shared goals', '50%', '50%']); add(['To shared goals', '-', '-', '-']); add(['Kept personally', '-', '-', '-']);
  return rows;
}

module.exports = { tracker };

// An invented family phone plan tracker, laid out like the real one: a by-person table under
// "Bill due M/D" headings, then a by-payment table ("Bill N - who"), "Our total" and "Credit".
function phoneTracker() {
  return [['Bill breakdown by person'],
    ['', 'Bill due 9/12', 'Bill due 10/12', 'Bill due 11/12'],
    ['Pat', '$40.00', '$41.00', '$42.00'], ['Sam', '$30.00', '$30.00', '$30.00'],
    ['Robin', '$50.00', '$50.00', '$51.00'], ['Lee', '$20.00', '$20.00', '$20.00'], ['Kim', '$25.00', '$25.00', '$25.50'],
    ['Insurance', '$0.00', '$0.00', '$0.00'], ['Total Plan Due', '$165.00', '$166.00', '$168.50'], ['Insurance Share', '$1.00', '$1.00', '$1.00'],
    [], ['If it makes it easier, the total due for each payment'],
    ['', '', 'Bill due 10/12', 'Bill due 11/12'],
    ['Bill 1 - Pat', '', '$41.00', '$42.00'], ['Bill 2 - Sam', '', '$30.00', '$30.00'],
    ['Bill 3 - Group (Robin & Lee)', '', '$70.00', '$71.00'], ['Bill 4 - Kim', '', '$25.00', '$25.50'],
    [], ['Our total', '', '', '$72.00'], ['Credit', '', '', '$96.50']];
}
module.exports.phoneTracker = phoneTracker;
