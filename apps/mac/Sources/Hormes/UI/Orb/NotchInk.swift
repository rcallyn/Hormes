import AppKit

/// Solid black shape attached to the hardware notch, with animated corner geometry.
enum NotchInk {
    // MARK: shape

    /// The island's convex top corners, where it hangs from the menu bar: generous, so
    /// the open island's top edges read rounded against the bar (User, 2026-09-11:
    /// "these are the top edges we need to make rounded") — larger than the fillet, which
    /// only has to carry the eye from the column onto the edge.
    static let topRadius: CGFloat = 18
    /// The concave fillet from the notch's column onto the island's top edge. Inside
    /// the menu bar band by construction (the arc is tangent to the column `fillet`
    /// above the bar's bottom edge): the widening begins on the notch itself, about
    /// where the hardware notch's own bottom corners begin to round, and the flare
    /// continues that curve instead of a hard-cornered rectangle hung under the bar.
    static let fillet: CGFloat = 14

    struct Shape {
        let path: CGPath
        /// The island, snapped to device pixels (view coordinates, y down).
        let island: CGRect
        let topRadius: CGFloat
        let fillet: CGFloat
        /// The bottom corners: the notch's 12 pt folded, `NotchGeometry.bottomRadius` open.
        let bottomRadius: CGFloat
    }

    /// How open the island is for a `height` points tall: 0 up to the peek's height (the
    /// lip, the peek and the strip), 1 at the island's, eased between, so it follows the
    /// height spring and never steps. The bottom corners grow with it; `render(_:)`'s
    /// `sizeT` is the same function of the height, so the ink opens with the silhouette.
    static func openLevel(height h: CGFloat) -> CGFloat {
        let lo = NotchGeometry.peekHeight, hi = NotchGeometry.islandHeight
        guard h.isFinite, hi > lo else { return 0 }
        let t = min(1, max(0, (h - lo) / (hi - lo)))
        return t * t * (3 - 2 * t)
    }

    /// The bottom corners' radius for an island `h` points tall: the notch's 12 pt folded,
    /// growing to `NotchGeometry.bottomRadius` open, never past half the height.
    static func bottomCornerRadius(height h: CGFloat) -> CGFloat {
        min(NotchGeometry.radius + (NotchGeometry.bottomRadius - NotchGeometry.radius) * openLevel(height: h), h / 2)
    }

    /// A convex top corner's radius on a side where the island runs `e` points past the
    /// notch's column: the rounded top edge is what must read, so it takes the excess first
    /// (the fillet gets what is left), capped by `topRadius` and by the height left over
    /// the bottom corner `r`. None without an excess (the lip, a peek the notch's width).
    static func topCornerRadius(excess e: CGFloat, height h: CGFloat, bottomRadius r: CGFloat) -> CGFloat {
        guard e > 0.25 else { return 0 }
        return min(topRadius, max(0, h - r), e * 0.6)
    }

    /// `column` is the notch's x-span, `island` the island rect this frame (its minY is
    /// the menu bar's bottom edge, the column's end), both in the view's flipped
    /// coordinates; `scale` the backing scale for the pixel snapping.
    static func shape(column: ClosedRange<CGFloat>, island islandIn: CGRect, scale: CGFloat) -> Shape {
        let s = scale.isFinite ? max(1, scale) : 2
        func snap(_ v: CGFloat) -> CGFloat { (v * s).rounded() / s }
        let cL = snap(column.lowerBound), cR = snap(column.upperBound)
        // An island that is not a rect (a spring gone bad) is the column alone, no island.
        let island = islandIn.isFiniteRect ? islandIn : CGRect(x: cL, y: islandIn.minY.isFinite ? islandIn.minY : 0, width: cR - cL, height: 0)
        let y0 = snap(island.minY)
        let y1 = max(y0, snap(island.maxY))
        // Never narrower than the column: the spring undershoots a hair on the way back.
        let x0 = min(snap(island.minX), cL), x1 = max(snap(island.maxX), cR)
        let h = y1 - y0
        let snapped = CGRect(x: x0, y: y0, width: x1 - x0, height: h)
        let path = CGMutablePath()
        if h < 0.5 {
            path.addRect(CGRect(x: cL, y: 0, width: cR - cL, height: y0))
            return Shape(path: path, island: snapped, topRadius: 0, fillet: 0, bottomRadius: 0)
        }
        let r = bottomCornerRadius(height: h)
        // Per side: the excess over the column is shared between the top corner (first —
        // the rounded top edge is what must read) and the fillet (what is left), each
        // capped, the corner also by the height, the fillet by the bar (it lives in it).
        func corners(excess e: CGFloat) -> (fillet: CGFloat, top: CGFloat) {
            guard e > 0.25 else { return (0, 0) }
            let t = topCornerRadius(excess: e, height: h, bottomRadius: r)
            let f = min(fillet, e - t, y0)
            return (f, t)
        }
        let left = corners(excess: cL - x0), right = corners(excess: x1 - cR)

        path.move(to: CGPoint(x: cL, y: 0))
        if left.fillet > 0.25 {
            path.addLine(to: CGPoint(x: cL, y: y0 - left.fillet))
            path.addArc(tangent1End: CGPoint(x: cL, y: y0), tangent2End: CGPoint(x: cL - left.fillet, y: y0), radius: left.fillet)
        } else {
            path.addLine(to: CGPoint(x: cL, y: y0))
        }
        if left.top > 0.25 {
            path.addLine(to: CGPoint(x: x0 + left.top, y: y0))
            path.addArc(tangent1End: CGPoint(x: x0, y: y0), tangent2End: CGPoint(x: x0, y: y0 + left.top), radius: left.top)
        } else {
            path.addLine(to: CGPoint(x: x0, y: y0))
        }
        path.addLine(to: CGPoint(x: x0, y: y1 - r))
        path.addArc(tangent1End: CGPoint(x: x0, y: y1), tangent2End: CGPoint(x: x0 + r, y: y1), radius: r)
        path.addLine(to: CGPoint(x: x1 - r, y: y1))
        path.addArc(tangent1End: CGPoint(x: x1, y: y1), tangent2End: CGPoint(x: x1, y: y1 - r), radius: r)
        if right.top > 0.25 {
            path.addLine(to: CGPoint(x: x1, y: y0 + right.top))
            path.addArc(tangent1End: CGPoint(x: x1, y: y0), tangent2End: CGPoint(x: x1 - right.top, y: y0), radius: right.top)
        } else {
            path.addLine(to: CGPoint(x: x1, y: y0))
        }
        if right.fillet > 0.25 {
            path.addLine(to: CGPoint(x: cR + right.fillet, y: y0))
            path.addArc(tangent1End: CGPoint(x: cR, y: y0), tangent2End: CGPoint(x: cR, y: y0 - right.fillet), radius: right.fillet)
        } else {
            path.addLine(to: CGPoint(x: cR, y: y0))
        }
        path.addLine(to: CGPoint(x: cR, y: 0))
        path.closeSubpath()
        return Shape(path: path, island: snapped, topRadius: max(left.top, right.top), fillet: max(left.fillet, right.fillet), bottomRadius: r)
    }

}
