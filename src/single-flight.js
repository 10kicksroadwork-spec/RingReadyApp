const flights = new Map();

export function isSingleFlightActive(key) {
  return flights.has(String(key));
}

export function runSingleFlight(key, task) {
  const flightKey = String(key);
  const existing = flights.get(flightKey);
  if (existing) return existing;

  const flight = Promise.resolve()
    .then(task)
    .finally(() => {
      if (flights.get(flightKey) === flight) {
        flights.delete(flightKey);
      }
    });

  flights.set(flightKey, flight);
  return flight;
}

export function clearSingleFlightsForTest() {
  flights.clear();
}
