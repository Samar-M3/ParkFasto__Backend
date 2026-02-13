const ParkingLot = require("../models/ParkingLot.model");
const ParkingSession = require("../models/ParkingSession.model");
const Notification = require("../models/Notification.model");

const resolveLotStatus = (occupiedSpots, totalSpots) =>
  occupiedSpots >= totalSpots ? "full" : "available";

const syncLotStatus = async (parkingLotId, occupiedDelta) => {
  const updatedLot = await ParkingLot.findByIdAndUpdate(
    parkingLotId,
    { $inc: { occupiedSpots: occupiedDelta } },
    { new: true },
  );

  if (!updatedLot) return null;

  const newStatus = resolveLotStatus(updatedLot.occupiedSpots, updatedLot.totalSpots);
  if (updatedLot.status !== newStatus) {
    await ParkingLot.findByIdAndUpdate(parkingLotId, { status: newStatus });
  }

  return updatedLot;
};

/**
 * User Bookings Controller
 * Retrieves all parking history (active and completed) for the logged-in user.
 */
exports.getUserBookings = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const sessions = await ParkingSession.find({ user: userId })
      .populate("parkingLot") // Join with parking lot details
      .sort({ createdAt: -1 }); // Newest bookings first

    res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
};

/**
 * Get All Parking Lots
 * Fetches all available parking locations. If user coordinates are provided,
 * it calculates the distance and sorts them by proximity.
 */
exports.getAllParkingLots = async (req, res, next) => {
  try {
    const { lat, lon } = req.query;
    let lots = await ParkingLot.find();

    // Proximity calculation logic
    if (lat && lon) {
      const userLat = parseFloat(lat);
      const userLon = parseFloat(lon);

      lots = lots
        .map((lot) => {
          // Haversine formula implementation for spherical distance
          const dLat = ((lot.lat - userLat) * Math.PI) / 180;
          const dLon = ((lot.lon - userLon) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((userLat * Math.PI) / 180) *
              Math.cos((lot.lat * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = 6371 * c; // Result in kilometers
          return { ...lot.toObject(), distance };
        })
        .sort((a, b) => a.distance - b.distance); // Nearest lots first
    }

    res.status(200).json({ success: true, data: lots });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Active Session
 * Checks if the user currently has an ongoing parking session.
 */
exports.getActiveSession = async (req, res, next) => {
  try {
    const session = await ParkingSession.findOne({
      user: req.user._id,
      status: "active",
    }).populate("parkingLot");

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * Guard QR Entry
 * Process user entry when guard scans the user's QR code.
 * Changes session status from 'booked' to 'active' or starts a new session.
 */
exports.guardEntry = async (req, res, next) => {
  try {
    const { userId, parkingLotId } = req.body;
    const lot = await ParkingLot.findById(parkingLotId).select("name");

    // Find the latest booking for this user at this parking lot
    let session = await ParkingSession.findOne({
      user: userId,
      parkingLot: parkingLotId,
      status: "booked",
    }).sort({ createdAt: -1 });

    if (!session) {
      // If no booking found, create a new active session directly (walk-in)
      session = await ParkingSession.create({
        user: userId,
        parkingLot: parkingLotId,
        status: "active",
        startTime: new Date(),
      });

      // Update occupancy for walk-in
      await syncLotStatus(parkingLotId, 1);
    } else {
      // If booking exists, activate it
      session.status = "active";
      session.startTime = new Date();
      await session.save();
      // Occupancy was already incremented during booking
    }

    await Notification.create({
      user: userId,
      type: "checkin",
      title: "Check-in Successful",
      message: `Your vehicle check-in was recorded at ${lot?.name || "the parking lot"}.`,
      metadata: {
        parkingLot: parkingLotId,
        session: session._id,
      },
    });

    res.status(200).json({ success: true, message: "Entry successful", data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * Guard QR Exit
 * Process user exit when guard scans the user's QR code.
 * Completes the active session and frees up the parking slot.
 */
exports.guardExit = async (req, res, next) => {
  try {
    const { userId, parkingLotId } = req.body;

    const session = await ParkingSession.findOne({
      user: userId,
      parkingLot: parkingLotId,
      status: "active",
    }).populate("parkingLot");

    if (!session) {
      return res.status(404).json({ success: false, message: "No active session found for this user" });
    }

    const endTime = new Date();
    const durationHours = Math.max(1, Math.ceil((endTime - session.startTime) / (1000 * 60 * 60)));
    const totalAmount = durationHours * session.parkingLot.pricePerHour;

    session.endTime = endTime;
    session.totalAmount = totalAmount;
    session.status = "completed";
    await session.save();

    // Free up the slot
    const slotsToRelease = Math.max(1, Number(session.slots) || 1);
    await syncLotStatus(parkingLotId, -slotsToRelease);

    await Notification.create({
      user: userId,
      type: "checkout",
      title: "Check-out Successful",
      message: `Your parking session was completed at ${session.parkingLot?.name || "the parking lot"}. Total: NPR ${totalAmount}.`,
      metadata: {
        parkingLot: parkingLotId,
        session: session._id,
      },
    });

    res.status(200).json({ success: true, message: "Exit successful", data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * Start Parking Session
 * Initializes a new parking session, checks for duplicates, and updates lot occupancy.
 */
exports.startSession = async (req, res, next) => {
  try {
    const { parkingLotId, vehicleType } = req.body;

    // Prevention: User can only have ONE active session at a time
    const existingSession = await ParkingSession.findOne({
      user: req.user._id,
      status: "active",
    });

    if (existingSession) {
      return res.status(400).json({
        success: false,
        message: "User already has an active session",
      });
    }

    // Create the session record
    const session = await ParkingSession.create({
      user: req.user._id,
      parkingLot: parkingLotId,
      vehicleType,
    });

    // Update real-time occupancy of the chosen lot
    await syncLotStatus(parkingLotId, 1);

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

// Book parking (create a future/reserved parking session)
exports.bookParking = async (req, res, next) => {
  try {
    const { parkingLotId, slots = 1, startTime, endTime } = req.body;
    const requestedSlots = Number(slots);

    if (!parkingLotId || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "parkingLotId, startTime and endTime are required",
      });
    }
    if (!Number.isInteger(requestedSlots) || requestedSlots < 1) {
      return res.status(400).json({
        success: false,
        message: "slots must be a positive whole number",
      });
    }

    const lot = await ParkingLot.findById(parkingLotId);
    if (!lot) {
      return res
        .status(404)
        .json({ success: false, message: "Parking lot not found" });
    }

    const available = lot.totalSpots - (lot.occupiedSpots || 0);
    if (available < requestedSlots) {
      return res.status(400).json({
        success: false,
        message: "Not enough available slots for requested booking",
      });
    }

    // create booking session with status 'booked'
    const session = await ParkingSession.create({
      user: req.user._id,
      parkingLot: parkingLotId,
      vehicleType: lot.type === "bike" ? "bike" : "car",
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      slots: requestedSlots,
      status: "booked",
    });

    // Reserve slots by incrementing occupiedSpots
    await syncLotStatus(parkingLotId, requestedSlots);

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

// Cancel a booked parking session and release reserved slots
exports.cancelBooking = async (req, res, next) => {
  try {
    const { bookingId } = req.params;

    const session = await ParkingSession.findOne({
      _id: bookingId,
      user: req.user._id,
      status: "booked",
    }).populate("parkingLot", "name");

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Booked session not found or cannot be canceled",
      });
    }

    session.status = "canceled";
    session.endTime = new Date();
    await session.save();

    const slotsToRelease = Math.max(1, Number(session.slots) || 1);
    await syncLotStatus(session.parkingLot?._id || session.parkingLot, -slotsToRelease);

    await Notification.create({
      user: req.user._id,
      type: "booking",
      title: "Booking Canceled",
      message: `Your booking at ${session.parkingLot?.name || "the parking lot"} was canceled.`,
      metadata: {
        parkingLot: session.parkingLot?._id || session.parkingLot,
        session: session._id,
      },
    });

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

// Complete a parking session (Ends session and calculates revenue)
exports.completeSession = async (req, res, next) => {
  try {
    const session = await ParkingSession.findOne({
      user: req.user._id,
      status: "active",
    }).populate("parkingLot");

    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "No active session found" });
    }

    const endTime = new Date();
    const startTime = new Date(session.startTime);
    const durationHours = Math.max(
      1,
      Math.ceil((endTime - startTime) / (1000 * 60 * 60)),
    );
    const totalAmount = durationHours * session.parkingLot.pricePerHour;

    session.endTime = endTime;
    session.totalAmount = totalAmount;
    session.status = "completed";
    await session.save();

    // Decrement occupied spots
    const slotsToRelease = Math.max(1, Number(session.slots) || 1);
    await syncLotStatus(session.parkingLot._id, -slotsToRelease);

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};
