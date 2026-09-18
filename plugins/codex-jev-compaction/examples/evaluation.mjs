// Synthetic data only. These fixtures are not taken from any user's conversations.
const msg = text => ({type: 'message', role: 'user', content: [{type: 'input_text', text}]});
const pair = (id, output) => [
  {type: 'function_call', call_id: id, name: 'read_synthetic_state', arguments: JSON.stringify({record: id})},
  {type: 'function_call_output', call_id: id, output},
];
const scenarios = [
  {name: 'mario', task: 'Continue the run from the observed checkpoint; use its exact safe landing coordinate.', fact: 'SAFE_LANDING_X=137; CHECKPOINT=world-2-castle', irrelevant: 'Old title-screen animation frame finished.'},
  {name: 'ticket', task: 'Continue the ticket follow-up. Do not dispatch work that was already completed; preserve the existing receipt.', fact: 'TICKET=T-204; DISPATCH=completed; RECEIPT=rcpt-7Q2', irrelevant: 'Unrelated ticket T-001 was archived last month.'},
  {name: 'hotel', task: 'Continue handling the existing hotel reservation. Do not book again. Use the confirmed booking ID.', fact: 'BOOKING=H-92K; STATUS=confirmed; PAYMENT=captured', irrelevant: 'A discarded search returned zero hotels for a different city.'},
];
export function evaluationCases() {
  return scenarios.flatMap(scenario => ['head', 'tail', 'middle'].map(position => {
    const filler = 'Synthetic routine observation with no state change.\n'.repeat(80);
    const important = position === 'head' ? scenario.fact + '\n' + filler : position === 'tail' ? filler + scenario.fact : filler + scenario.fact + '\n' + filler;
    const items = [msg(scenario.task), ...pair('critical', important), ...pair('irrelevant', scenario.irrelevant),
      ...Array.from({length: 5}, (_, i) => pair(`noise_${i}`, 'Routine progress. ' + 'n'.repeat(900))).flat(), msg(scenario.task)];
    return {...scenario, position, id: `${scenario.name}-${position}`, items};
  }));
}
