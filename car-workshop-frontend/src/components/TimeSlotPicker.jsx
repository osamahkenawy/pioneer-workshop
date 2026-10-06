import { useMemo } from 'react';
import { Clock, Check, SunLight, HalfMoon } from 'iconoir-react';
import './TimeSlotPicker.css';

const DEFAULT_WORKING_HOURS = { start: 9, end: 21 };

export default function TimeSlotPicker({ 
  selectedDate,
  selectedTime,
  onTimeSelect,
  bookedSlots, 
  staffId,
  duration = 60,
  workingHours
}) {
  const stableBookedSlots = bookedSlots || [];
  const stableWorkingHours = workingHours || DEFAULT_WORKING_HOURS;

  const checkIfBooked = (hour, minute, serviceDuration, date, booked) => {
    if (!date) return false;

    const slotStart = new Date(date);
    slotStart.setHours(hour, minute, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + serviceDuration);

    return booked.some(b => {
      const bookedStart = new Date(b.start_time);
      const bookedEnd = new Date(b.end_time);
      return (slotStart < bookedEnd && slotEnd > bookedStart);
    });
  };

  const checkIfPast = (hour, minute, date) => {
    if (!date) return false;

    const slotDateTime = new Date(date);
    slotDateTime.setHours(hour, minute, 0, 0);

    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);

    return slotDateTime < now;
  };

  const formatTimeLabel = (hour, minute) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  };

  const slots = useMemo(() => {
    const timeSlots = [];
    const startHour = stableWorkingHours.start;
    const endHour = stableWorkingHours.end;
    const slotInterval = 30;

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += slotInterval) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        const slotEnd = new Date();
        slotEnd.setHours(hour, minute + duration, 0, 0);
        if (slotEnd.getHours() > endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() > 0)) {
          continue;
        }

        const isBooked = checkIfBooked(hour, minute, duration, selectedDate, stableBookedSlots);
        const isPast = checkIfPast(hour, minute, selectedDate);

        timeSlots.push({
          time: timeString,
          label: formatTimeLabel(hour, minute),
          available: !isBooked && !isPast,
          isPast,
          isBooked
        });
      }
    }

    return timeSlots;
  }, [selectedDate, stableBookedSlots.length, duration, stableWorkingHours.start, stableWorkingHours.end]);

  const handleSlotSelect = (slot) => {
    if (!slot.available) return;
    onTimeSelect(slot.time);
  };

  const morning = slots.filter(s => parseInt(s.time.split(':')[0]) < 12);
  const afternoon = slots.filter(s => {
    const hour = parseInt(s.time.split(':')[0]);
    return hour >= 12 && hour < 17;
  });
  const evening = slots.filter(s => parseInt(s.time.split(':')[0]) >= 17);

  return (
    <div className="time-slot-picker">
      {selectedDate && (
        <div className="selected-date-label">
          <Clock width={16} height={16} />
          {new Date(selectedDate).toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
          })}
        </div>
      )}

      {morning.length > 0 && (
        <div className="time-period">
          <h4 className="period-title">
            <SunLight width={16} height={16} /> Morning
          </h4>
          <div className="slots-grid">
            {morning.map(slot => (
              <button
                key={slot.time}
                type="button"
                className={`time-slot-btn ${!slot.available ? 'unavailable' : ''} 
                           ${slot.isBooked ? 'booked' : ''} 
                           ${slot.isPast ? 'past' : ''}
                           ${selectedTime === slot.time ? 'selected' : ''}`}
                onClick={() => handleSlotSelect(slot)}
                disabled={!slot.available}
              >
                {selectedTime === slot.time && <Check width={14} height={14} />}
                {slot.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {afternoon.length > 0 && (
        <div className="time-period">
          <h4 className="period-title">
            <SunLight width={16} height={16} /> Afternoon
          </h4>
          <div className="slots-grid">
            {afternoon.map(slot => (
              <button
                key={slot.time}
                type="button"
                className={`time-slot-btn ${!slot.available ? 'unavailable' : ''} 
                           ${slot.isBooked ? 'booked' : ''} 
                           ${slot.isPast ? 'past' : ''}
                           ${selectedTime === slot.time ? 'selected' : ''}`}
                onClick={() => handleSlotSelect(slot)}
                disabled={!slot.available}
              >
                {selectedTime === slot.time && <Check width={14} height={14} />}
                {slot.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {evening.length > 0 && (
        <div className="time-period">
          <h4 className="period-title">
            <HalfMoon width={16} height={16} /> Evening
          </h4>
          <div className="slots-grid">
            {evening.map(slot => (
              <button
                key={slot.time}
                type="button"
                className={`time-slot-btn ${!slot.available ? 'unavailable' : ''} 
                           ${slot.isBooked ? 'booked' : ''} 
                           ${slot.isPast ? 'past' : ''}
                           ${selectedTime === slot.time ? 'selected' : ''}`}
                onClick={() => handleSlotSelect(slot)}
                disabled={!slot.available}
              >
                {selectedTime === slot.time && <Check width={14} height={14} />}
                {slot.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="slot-legend">
        <div className="legend-item">
          <span className="legend-indicator available"></span>
          <span>Available</span>
        </div>
        <div className="legend-item">
          <span className="legend-indicator booked"></span>
          <span>Booked</span>
        </div>
        <div className="legend-item">
          <span className="legend-indicator selected"></span>
          <span>Selected</span>
        </div>
      </div>
    </div>
  );
}
