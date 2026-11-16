import { useEffect, useId, useState } from 'react';
import { CURATED_CITIES, getLocalitiesForCity } from '../../utils/regions';

interface RegionFieldsProps {
  idPrefix: string;
  city: string;
  locality: string;
  onCityChange: (city: string) => void;
  onLocalityChange: (locality: string) => void;
}

function isCuratedCity(val: string): boolean {
  return CURATED_CITIES.some((c) => c.toLowerCase() === val.trim().toLowerCase());
}

export function RegionFields({
  idPrefix,
  city,
  locality,
  onCityChange,
  onLocalityChange,
}: RegionFieldsProps) {
  const datalistId = useId();
  const [otherSelected, setOtherSelected] = useState<boolean>(
    Boolean(city.trim()) && !isCuratedCity(city),
  );

  useEffect(() => {
    if (city.trim() && !isCuratedCity(city)) {
      setOtherSelected(true);
    } else if (!city.trim()) {
      // keep user choice if they selected Other and cleared text
    } else {
      setOtherSelected(false);
    }
  }, [city]);

  const curatedMatch = CURATED_CITIES.find(
    (c) => c.toLowerCase() === city.trim().toLowerCase(),
  );
  const selectValue = otherSelected ? '__OTHER__' : curatedMatch || '';
  const suggestedLocalities = getLocalitiesForCity(city);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-city`} className="block text-sm font-medium text-slate-700">
          City *
        </label>
        <select
          id={`${idPrefix}-city`}
          required
          value={selectValue}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '__OTHER__') {
              setOtherSelected(true);
              if (isCuratedCity(city)) {
                onCityChange('');
              }
            } else {
              setOtherSelected(false);
              onCityChange(val);
            }
          }}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
        >
          <option value="">Select city</option>
          {CURATED_CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__OTHER__">Other city...</option>
        </select>
        {otherSelected && (
          <input
            id={`${idPrefix}-city-other`}
            aria-label="Enter custom city"
            type="text"
            required
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="Enter city name"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
        )}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-locality`} className="block text-sm font-medium text-slate-700">
          Locality / Area *
        </label>
        <input
          id={`${idPrefix}-locality`}
          type="text"
          required
          list={datalistId}
          value={locality}
          onChange={(e) => onLocalityChange(e.target.value)}
          placeholder={
            suggestedLocalities.length > 0
              ? `e.g. ${suggestedLocalities.slice(0, 2).join(', ')}`
              : 'e.g. Indiranagar, Koramangala'
          }
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
        />
        <datalist id={datalistId}>
          {suggestedLocalities.map((loc) => (
            <option key={loc} value={loc} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
