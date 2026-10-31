(ns nautilus-log-v1
  (:require [clojure.string :as str]
            [reagent.core :as r]
            [roam.datascript :as rd]))

;; ------- default settings -------

(def init-duration 15) ;; value used when no duration is specified as a render parameter

(def init-len-limit 22) ;; value used when no legend length limit is specified as a render parameter

(def custom-color-1 "rgba(194,75,75,0.72)")

(def init-custom-color-1-tag "")

(def init-workday-start 300)

;; ------- other defaults –––––––

(def init-workday-end 1260)

(def init-starting-distance 30)

;; ------ legend placement vs performance ----------

(def tries-treshold 25) ;; number of legend placement guesses; lower number = faster but more likely to overlap

;; -------------- scaling ---------------

(defonce mobile? js/window.roamAlphaAPI.platform.isMobile)

(def start-svg-rect-ratio 0.7)

(defonce snail-scaler (if mobile? 0.7 1)) ;; changes the size of the snail (and thus proportions of the whole chart)

(def mob-width 450) ;; default start width value on mobile

(def desk-width 600) ;; default start width value on desktop

;; ---------- mostly visual dev settings ------------

(def shaky false) ;; beta feature

(def reserve 15) ;; reserve space left and right

(def bent-line-gap 3) ;; the space between the bent line and the legend rectangle

(def rect-width-coef 1.55) ;; bigger number = narrower text rect (for legend)

(def rect-height-coef 1.15) ;; bigger number = taller text rect (for legend)

(def font-family "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif")

(def font-size (if mobile? 12 14))

(def snail-blueprint-outer-radiuses
  (concat (repeat 5 0) [135 140 145 150] (range 145 65 -5) [68 66 64 62]))

(def snail-inner-radius (* 50 snail-scaler))

(defn outer-radius-at [t]
  (* (nth snail-blueprint-outer-radiuses t) snail-scaler))

(defn spiral-profile-index [minute settings]
  (let [workday-start (:workday-start settings)
        offset (max 0 (quot (- (int minute) workday-start) 60))]
    (min (dec (count snail-blueprint-outer-radiuses)) (+ 5 offset))))

(declare log-core-call)

(defn spiral-outer-radius [minute settings]
  (or (log-core-call "shellRadius" {:minute minute :startMinutes (:workday-start settings)
                                    :radiusScale snail-scaler}) 0))

(def len-central-legend 16) ;; length of the central legend description (page name or date)

;; ----------------- colors, darling ---------------

(def snail-template-color "var(--nautilus-log-spiral)")

(def clock-hand-color "#EA0F0F5B")

(def task-legend-color "var(--nautilus-log-task)")

(def task-fill-color "var(--nautilus-log-task-fill)")

(def meeting-fill-color "var(--nautilus-log-event-fill)")

(def completed-fill-color "var(--nautilus-log-completed-fill)")

(def past-event-fill-color "var(--nautilus-log-past-event-fill)")

;; -------------- debug support ------------ 

(def debug-state-atom (r/atom false))        
                                             
(defn safe-prn [s]
    (clojure.pprint/pprint s)
    s)                                      

(defn safe-prn-debug? [s]                           
  (when @debug-state-atom                    
    (clojure.pprint/pprint s)                
    s))                                      
                                             
(defn println?debug [& args]                 
  (when @debug-state-atom                    
    (apply println args)))                   
                                             
(defn pprint-all [& args]                    
  (clojure.pprint/pprint (apply str args)))  
                                             
(defn pprint?debug [& args]                      
  (when @debug-state-atom                        
    (clojure.pprint/pprint (apply str args))))   
                                             
(defn draw-debug-rects [rects]                
  [:g (for [{:keys [w h x y]} rects]          
        [:g                                   
         [:rect                               
          {:style {:fill "rgba(128,128,128,0.32)"}    
           :x x                
           :y y                
           :width w            
           :height h}]])])     

;; ---------- resolving (()) references -----------

(defn str-with-resolved-block-refs [{:keys [block/string block/refs]}]
  (reduce (fn [string ref-ent]
            (str/replace string (str "((" (:block/uid ref-ent) "))") (:block/string ref-ent)))
          string
          refs))

;; --------- math is beautiful ---------

(def pi js/Math.PI)

(defn abs [x] (js/Math.abs x))

(defn cos [x] (js/Math.cos x))

(defn sin [x] (js/Math.sin x))

(defn round2 [num]
  (-> (* num 100)
      (js/Math.round)
      (/ 100.0)))

(defn angle->rad [angle]
  (* (- 180 angle) (/ pi 180)))

(defn pos-sweep-angle
  "Correctly calculates the angular range"
  [start-radians end-radians]
  (- (* 2 pi) (if (> end-radians start-radians)
                (- end-radians start-radians)
                (+ (- end-radians start-radians) (* 2 pi)))))

(defn pos-sweep-angle-mid
  "Correctly calculates the middle of the angular range"
  [start-radians end-radians]
  (+ end-radians (/ (pos-sweep-angle start-radians end-radians) 2)))

(defn min->angle [minutes]
  (mod (/ (- minutes 540) 2) 360))

;; --------------- legend collision solution -----------

(defn between [x a b]
  (and (>= x a) (<= x b)))

(defn collide? [new-rect any-rect]
  (let [ntlx (:x new-rect)
        ntly (:y new-rect)
        nbrx (+ ntlx (:w new-rect))
        nbry (+ ntly (:h new-rect))
        tlx (:x any-rect)
        tly (:y any-rect)
        brx (+ tlx (:w any-rect))
        bry (+ tly (:h any-rect))]
    (not (or (< nbrx tlx)
             (> ntlx brx)
             (< nbry tly)
             (> ntly bry)))))

(defn collides?
  "Tests if new-rect overlaps with any of the rects"
  [new-rect rects]
  (boolean (some #(collide? new-rect %) rects)))

(defn at-vertex [radians]
  (or (between radians 1.01 2.05) (between radians -2.05 -1.01)))

(defn iterate-rect-place
  "returns the new coordinates of new-rect that does not overlap with any of the rects;
   radians - the angle at which new-rect first tries to position itself;
   radius - the distance from the center;
   text – the legend text that is written to the debug console 
   radians-span - the maximum angular deviation"
     
  [new-rect rects start-radians start-radius text center]
  (let [max-legend-radius (* start-radius 1.7) ;; maximum legend radius to try
        max-radians-span (/ pi 17)] ;; maximum angle span for legend to try
    (loop [radians start-radians
           radius start-radius
           angle-offset  0
           radius-offset 0
           counter 0
           radius-inc 3 ;; radius offset step size
           trying (if (at-vertex radians) :radius :angle)]
      (let [min-radians (- radians (/ max-radians-span 2))
            max-radians (+ radians (/ max-radians-span 2))
          ; min-radius (- start-radius 10) 
            x (+ (:center-x center) (* (cos radians) radius))
            y (+ (:center-y center) (* (sin radians) radius))
            on-left? (or (> radians (/ pi 2)) (< radians (- (/ pi 2))))
            at-vertex? (at-vertex radians)
            horizontal-shift (if at-vertex?
                               (/ (:w new-rect) 2)
                               (if on-left?
                                 (:w new-rect)
                                 0))
            vertical-shift (/ (:h new-rect) 2)
            new-rect (assoc new-rect :x (- x horizontal-shift) :y (- y vertical-shift) :radians radians)
            colliding? (collides? new-rect rects)]
        (pprint?debug text " TRYING: " trying " x: " (round2 x) " y: " (round2 y) 
                      " radius: " (round2 radius) " radians: " (round2 radians)   
                      " radius-offset " radius-offset                             
                      " angle-offset: " (round2 angle-offset)                     
                      " colliding?: " colliding? " counter " counter)             
        (if (or (> counter tries-treshold) (not colliding?)) ;; number of placement guesses; lower number = faster but more likely to overlap
          new-rect
          (if (= trying :radius) ;; testing placing using increased radius 
            (if (< radius max-legend-radius)
              (recur radians
                     (+ start-radius radius-offset)
                     angle-offset
                     (+ radius-offset radius-inc)
                     (inc counter)
                     radius-inc
                     :radius)
              (recur radians start-radius angle-offset radius-offset 0 0 :angle))
            (if (and (> radians min-radians) (< radians max-radians)) ;; testing increased/decreased angle 
              (recur (+ start-radians angle-offset)
                     radius
                     (if (or (= 0 angle-offset) (pos? angle-offset))
                       (- (+ 0.03 angle-offset)) ;; angle offset step size
                       (+ 0.03 (- angle-offset)))
                     radius-offset
                     (inc counter)
                     0
                     :angle)
              (recur start-radians start-radius angle-offset radius-offset 0 radius-inc :radius))))))))

(defn real-rect-radians [rect center]
  (let [rcenter-x (+ (:x rect) (/ (:w rect) 2))
        rcenter-y (+ (:y rect) (/ (:h rect) 2))
        center-x (:center-x center)
        center-y (:center-y center)]
    (js/Math.atan2 (- rcenter-y center-y) (- rcenter-x center-x))))

(defn display-width [s]
  (reduce + (map #(if (> (.charCodeAt % 0) 255) 2 1) s)))

(declare log-core-call)

(defn get-legend-rect
  "Places one bounded overview label, or hides it when the fixed rails are full."
  [rects text slice-radians _outer-radius center _settings order-key anchor-y]
  (let [label (or (log-core-call "chartLabelMetrics"
                                 {:text text :font (str "600 " font-size "px " font-family)
                                  :fontSize font-size :maxWidth 170})
                  {:width (min 170 (+ 8 (* font-size (display-width text)))) :text text})
        w (:width label)
        h (* font-size rect-height-coef)
        max-spiral-radius (apply max (map outer-radius-at (range (count snail-blueprint-outer-radiuses))))
        external-rect (first
                       (log-core-call "placeExternalLabels"
                                      {:centerX (:center-x center)
                                       :centerY (:center-y center)
                                       :exclusionRadius max-spiral-radius
                                       :gap 16
                                       :trackGap 18
                                       :layout "side-rails"
                                       :maxVerticalOffset 158
                                       :rowGap 22
                                       :collisionPadding 6
                                       :occupiedRects rects
                                       :labels [{:uid text
                                                 :angle slice-radians
                                                 :anchorY anchor-y
                                                 :sortKey order-key
                                                 :width w
                                                 :height h}]}))
        inside-frame? (and external-rect
                           (>= (:x external-rect) 24)
                           (<= (+ (:x external-rect) (:w external-rect)) 696)
                           (>= (:y external-rect) 42)
                           (<= (+ (:y external-rect) (:h external-rect)) 378))]
    (when inside-frame?
      (assoc external-rect
             :text text
             :label-text (:text label)
             :core-placement? true
             :real-rect-radians (real-rect-radians external-rect center)))))

;; --------------- Log core bridge ----------------------

(defn log-core-call [function-name value]
  "Calls the single tested JavaScript scheduling core and turns its result into
   ordinary keywordized ClojureScript data. The extension entry point installs
   this object before any render block can mount."
  (try
    (let [core (.-nautilusLogCore js/window)
          function (aget core function-name)]
      (when function
        (js->clj (.call function nil (clj->js value)) :keywordize-keys true)))
    (catch :default _e nil)))

(defn task-core-call [function-name value]
  "Calls the tested JavaScript task-instance core. Keeping this projection in
   one place applies the same reference precedence everywhere: a bare wrapper
   inherits source TODO/DONE, an explicit outer marker owns today's status,
   and source completion time never leaks into today's instance."
  (try
    (let [core (.-nautilusLogTaskCore js/window)
          function (aget core function-name)]
      (when function
        (js->clj (.call function nil (clj->js value)) :keywordize-keys true)))
    (catch :default _e nil)))

(defn task-instance-row [child settings]
  (let [payload {:uid (:block/uid child)
                 :localString (:block/string child)
                 :references (mapv (fn [ref]
                                     {:uid (:block/uid ref)
                                      :string (:block/string ref)})
                                   (:block/refs child))
                 :fallbackMinutes (:default-duration settings)}
        instance (or
                  (try
                    (when-let [resolver (some-> js/window .-nautilusLogExtensionData .-resolveTaskInstance)]
                      (js->clj (.call resolver nil (clj->js payload)) :keywordize-keys true))
                    (catch :default _e nil))
                  ;; Compatibility fallback for a chart that mounts while an
                  ;; older extension entry point is still unloading.
                  (task-core-call "resolveTaskInstance" payload))]
    {:s (or (:effectiveString instance) (:block/string child))
     :uid (:block/uid child)
     :kind (:kind instance)
     :task-instance instance}))

(defn clock-render-context [page-title task-uids logical-end-minutes]
  "Reads one cached CLOCK snapshot for the displayed daily page. The entry
   bridge owns graph access so rendering multiple tasks does not repeat the
   global LOGBOOK query."
  (try
    (if-let [reader (some-> js/window .-nautilusLogExtensionData .-getClockRenderContext)]
      (js->clj (.call reader nil page-title (clj->js task-uids) logical-end-minutes) :keywordize-keys true)
      {:entries []})
    (catch :default _e {:entries []})))

(defn shell-options [center settings inner-radius]
  {:startMinutes (:workday-start settings) :endMinutes (:workday-end settings)
   :centerX (or (:center-x center) 0) :centerY (or (:center-y center) 0)
   :innerRadius inner-radius :radiusScale snail-scaler})

(defn shell-path [start end inner-radius center settings]
  (or (:path (log-core-call "shellInterval"
                            (assoc (shell-options center settings inner-radius) :start start :end end))) ""))

(defn spiral-cell-inner-radius [minute settings fallback-inner-radius]
  (or (:inner (log-core-call "shellRadii"
                             (assoc (shell-options nil settings fallback-inner-radius) :minute minute)))
      fallback-inner-radius))

(defn now-minutes []
  (let [now (new js/Date)]
    (+ (* (.getHours now) 60) (.getMinutes now))))



;; --------------- reading / writing Roam database ----------------------

(defn get-page-title [page-uid] ;; when you have a block-uid for a page
  (-> (rd/q '[:find ?title
              :in $ ?page-uid
              :where [?e :block/uid ?page-uid]
              [?e :node/title ?title]]
            page-uid)
      first
      first))

(defn page-title [block-uid]
  (str (rd/q
        '[:find ?parent-page-title .
          :in $ ?block-uid
          :where
          [?block :block/uid  ?block-uid]
          [?block :block/page ?page]
          [?page  :node/title ?parent-page-title]]
        block-uid)))

(defn daily-page? [block-uid]
  (if (= (page-title block-uid)
         (js/window.roamAlphaAPI.util.dateToPageTitle (new js/Date (.now js/Date))))
    true
    false))

(defn minutes->time [minutes]
  (let [h (mod (js/Math.floor (/ minutes 60)) 24)
        m (mod minutes 60)]
    (str (if (< h 10) (str "0" h) h) ":" (if (< m 10) (str "0" m) m))))

(defn duration-label [minutes]
  (or (log-core-call "formatDuration" minutes)
      (str (max 0 (int (or minutes 0))) "m")))

(defn timeline-tooltip-info [title kind-label start end hint]
  (let [time-range (str (minutes->time start) "–" (minutes->time end))
        duration (duration-label (- end start))]
    {:title title
     :meta (str kind-label " · " time-range " · " duration)
     :hint hint
     :aria-label (str title ". " kind-label ". " time-range ". " duration
                      (when (seq hint) (str ". " hint)))}))

(defn clear-detail-state! [detail-state]
  (reset! detail-state {:pointer nil :focus nil :expanded nil}))

(defn active-detail [detail-state]
  (let [{:keys [pointer focus expanded]} @detail-state]
    ;; Pointer ownership is temporary: once it leaves, a focused segment resumes
    ;; ownership instead of leaving a stale hover record in the fixed inspector.
    (or expanded pointer focus)))

(defn show-hover-tooltip! [detail-state owner info _event]
  ;; Timeline details belong to their local workspace, not to pointer or
  ;; viewport coordinates. Pointer and keyboard ownership are kept separately.
  (swap! detail-state assoc owner info))

(defn hide-hover-tooltip! [detail-state]
  (clear-detail-state! detail-state))

(defn clear-detail-on-workspace-exit! [detail-state event]
  (let [workspace (.-currentTarget event)
        next-target (.-relatedTarget event)
        next-inside? (try
                       (and next-target (.contains workspace next-target))
                       (catch :default _e false))]
    (when (and workspace (not next-inside?))
      ;; Pointer exit must not erase focused details; blur must not erase an
      ;; in-workspace pointer detail. Each owner is cleared independently.
      (case (.-type event)
        ("mouseleave" "mouseout") (swap! detail-state assoc :pointer nil)
        "blur" (swap! detail-state assoc :focus nil)
        (clear-detail-state! detail-state)))))

(defn event-detail-signature [event]
  (select-keys event [:description :start :end :meeting :todo :done :done-at :bg-color :status-origin
                      :chart-kind :time-claim :full-start :full-end :duration :planned-duration :estimate-unplaced-reason]))

(defn reconcile-detail-state! [detail-state event-signatures available-slot-keys past-gap-keys]
  (swap! detail-state
         (fn [owners]
           (reduce-kv (fn [next-state owner info]
                        (let [valid? (case (:detail-kind info)
                                       :event (contains? event-signatures [(:uid info) (:detail-signature info)])
                                       :available (contains? available-slot-keys (:uid info))
                                       :past-gap (contains? past-gap-keys (:uid info))
                                       false)]
                          (assoc next-state owner (if valid? info nil))))
                      owners
                      owners))))

(defn activate-detail! [detail-state info event]
  (.preventDefault event)
  (.stopPropagation event)
  (swap! detail-state assoc :expanded info :focus info :pointer nil)
  (some-> event .-currentTarget .focus))

(defn dismiss-inspection! [detail-state event]
  (.preventDefault event)
  (.stopPropagation event)
  (clear-detail-state! detail-state)
  (some-> event .-target .blur))

(defn inspection-keydown! [detail-state info event]
  (case (.-key event)
    ("Enter" " ") (activate-detail! detail-state info event)
    "Escape" (dismiss-inspection! detail-state event)
    nil))

(defn locate-plan-task! [uid hover-info-state event]
  (when (and (seq uid) event)
    (.preventDefault event)
    (.stopPropagation event)
    (when hover-info-state (hide-hover-tooltip! hover-info-state))
    (if-let [locate-task (some-> js/window .-nautilusLogExtensionData .-locatePlanTask)]
      (-> (js/Promise.resolve
           (.call locate-task nil uid (.-currentTarget event) (boolean (.-shiftKey event))))
          (.catch (fn [error]
                    (.error js/console "[Nautilus Log] Could not locate task" error))))
      (.warn js/console "[Nautilus Log] Task location is unavailable"))))

(defn task-keydown! [uid hover-info-state event]
  (when (= "Enter" (.-key event))
    (locate-plan-task! uid hover-info-state event)))

(defn chart-record-info [event copy]
  (let [title (:description event)
        kind (:chart-kind event)
        completed (get-in copy [:tooltips :completed])
        source? (= "source" (:status-origin event))
        estimate (str (get-in copy [:tooltips :estimated]) " "
                      (duration-label (or (:planned-duration event) (:duration event) 0)))
        range-text (when (and (number? (:full-start event)) (number? (:full-end event)))
                     (str (minutes->time (:full-start event)) "–" (minutes->time (:full-end event))))
        allocation? (= "estimated-allocation" (:time-claim event))
        actual? (or (= "actual" (:time-claim event)) (= "actual" (:duration-source event)))
        summary (if allocation?
                  (str completed " · " estimate)
                  (case kind
                    "completed-estimate-overflow" (str completed " · " estimate " · "
                                                       (get-in copy [:tooltips (case (:estimate-unplaced-reason event)
                                                                                "zero-duration" :zeroDuration
                                                                                "invalid-window" :invalidEstimateWindow
                                                                                :estimateOverflow)]))
                    "unplaced" (str (get-in copy [:tooltips :unplaced]) " · " estimate)
                    "outside-window" (str (when (:done event) (str completed " · "))
                                          (get-in copy [:tooltips :outsideWindow]) " · " range-text)
                    (cond
                      actual? (str completed " · " (get-in copy [:tooltips :actual]) " "
                                   (duration-label (or (:actual-minutes event) (- (:full-end event) (:full-start event))))
                                   " · " range-text)
                      (and (:done event) (:todo event) (not (:meeting event))) (str completed " · " estimate " · " range-text)
                      :else (str (when (:done event) (str completed " · "))
                                 (get-in copy [:tooltips (if (:meeting event) :event :task)]) " · " range-text
                                 " · " (duration-label (- (:full-end event) (:full-start event)))))))
        meta (str summary
                  (when allocation? (str " · " (get-in copy [:tooltips :estimatedAllocation]) " " range-text
                                         " · " (get-in copy [:tooltips :notRecordedCompletion])))
                  (when (not= kind "timed") (str " · " (get-in copy [:tooltips :notTimeScaled])))
                  (when (and (:done event) source?)
                    (str " · " (get-in copy [:tooltips :inheritedCompletion])))
                  (when (and actual? (not= kind "timed")) (str " · " (get-in copy [:tooltips :actual])))
                  (when (= "completion-estimate" (:time-claim event))
                    (str " · " (get-in copy [:tooltips :completionEstimate]))))]
    {:title title :meta meta :summary-meta summary :uid (:uid event)
     :tone (cond (:done event) "completed" (:meeting event) "event" :else "task")
     :detail-kind :event :detail-signature (event-detail-signature event)
     :aria-label (str title ". " meta (when (:todo event) (str ". " (get-in copy [:tooltips :locateTask]))))}))

(defn detail-region-component [detail-state copy container-width]
  (let [info (active-detail detail-state)
        {:keys [title meta summary-meta tone]} info
        active? (boolean (and (seq title) (seq meta)))
        expanded? (boolean (:expanded @detail-state))
        layout (or (log-core-call "chartTipLayout"
                                   {:title (or title "") :summary (or summary-meta meta "") :meta (or meta "")
                                    :containerWidth container-width :fontFamily font-family
                                    :moreLabel (get-in copy [:panels :more])})
                   {:mode "stacked" :contentMode "compact" :width 280 :expandedWidth 280 :more true})]
    [:aside {:class (str "nautilus-log-detail-region" (when expanded? " is-expanded"))
             :aria-label (get-in copy [:panels :details]) :aria-hidden (not active?) :aria-live "polite"
             :data-tip-mode (:mode layout) :data-tip-content (:contentMode layout) :data-tip-more (str (:more layout))
             :data-nautilus-detail (if active? "active" "idle")}
     (when active?
       [:div {:class (str "nautilus-log-detail-content" (when (:more layout) " has-more"))
              :style {:width (str (if expanded? (:expandedWidth layout) (:width layout)) "px")}}
        [:span {:class (str "nautilus-log-detail-tone nautilus-log-detail-tone--" tone) :aria-hidden "true"}]
        [:strong {:class (str "nautilus-log-detail-title"
                              (when (= :event (:detail-kind info)) (str " nautilus-log-detail-title--" tone)))} title]
        [:span {:class "nautilus-log-detail-meta"} (if expanded? meta (or summary-meta meta))]
        (when (or (:more layout) expanded?)
          [:button {:type "button" :class "nautilus-log-detail-expand" :aria-expanded expanded?
                    :aria-label (get-in copy [:panels (if expanded? :collapseDetails :expandDetails)])
                    :on-click (fn [event]
                                (.stopPropagation event)
                                (if expanded?
                                  ;; Less acts on this inspector, not the stale pointer
                                  ;; preview accumulated behind its expanded content.
                                  (swap! detail-state assoc :expanded nil :pointer nil :focus info)
                                  (swap! detail-state assoc :expanded info)))}
           (get-in copy [:panels (if expanded? :less :more)])])])]))

;; ---------------- helpers ----------------------

(defn update-opacity-str [color opacity]
  (if (re-find #",\s*[\d.]+\)$" color)
    (str/replace color #",\s*[\d.]+\)$" (str "," opacity ")"))
    color))

(defn shake-if [shaky]
  (if shaky (- (rand-int 4) 2) 0))


;; --------------- text parsers --------------------



(defn from-1224->min [time-str h12] ;; if h12 is "am"/"pm" ; h12 = nil => h24
  (let [pm? (re-find #"(?:pm|PM)" time-str)
        am?  (re-find #"(?:am|AM)" time-str)
        new-time-str (->
                      (str/replace time-str #"(?:am|AM|pm|PM)" "")
                      (str/trim))
        [hours new-mins] (if (re-find #"\:" new-time-str)
                           (mapv int (str/split new-time-str #":"))
                           [(int new-time-str) 0])
        new-hours (if (and (not am?) (or pm? (and h12 (= (clojure.string/lower-case h12) "pm"))))
                    (if (= hours 12) 12 (+ hours 12))
                    (if am?
                      (if (= hours 12) 0 hours)
                      hours))
        [h m] [(mod new-hours 24) (mod new-mins 60)]]
    [(+ m (* 60 h)) (or am? pm?)]))

(defn parse-time-range [s settings]
  (if-let [parsed (log-core-call "parseTimeRangeToken"
                                 {:text s
                                  :windowStartMinutes (:workday-start settings)
                                  :windowEndMinutes (:workday-end settings)})]
    (let [warnings (:warnings (log-core-call "uiCopy" (:language settings)))
          warning (case (:warningCode parsed)
                    "overnight" (:overnight warnings)
                    "sameTime" (:sameTime warnings)
                    nil)]
      {:range [(:start parsed) (:end parsed)]
       :warning warning
       :cleaned-str (:cleanedText parsed)})
    {:range nil :warning nil :cleaned-str s}))

(defn parse-duration [s settings]
  (if-let [parsed (log-core-call "parseDurationToken"
                                 {:text s :fallback (:default-duration settings)})]
    {:duration (:minutes parsed) :cleaned-str (:cleanedText parsed)}
    {:duration (:default-duration settings) :cleaned-str s}))

(defn parse-done-time [s]
  (let [done-time-format #"(?:^|\s)d((?:[01]?\d|2[0-3])(?::[0-5]\d)?)(?=\s|$)"
        done-time-match (re-find done-time-format s)]
    (if done-time-match
      (let [[done-token done-time-str] done-time-match
            [h m] (str/split done-time-str #":")
            cleaned-str (str/replace s done-token " ")]
        {:done-at (+ (if m (int m) 0) (* 60 (int h)))
         :cleaned-str cleaned-str})
      {:done-at nil :cleaned-str s})))

(defn parse-DONE [s]
  (let [done-format #"\{\{\[\[DONE\]\]\}\}"
        done-found? (re-find done-format s)]
    (if done-found?
      {:done true
       :cleaned-str (str/replace s done-format "")}
      {:done false :cleaned-str s})))

(def get-color-pattern
  (memoize (fn [tag]
             (re-pattern (str "(?<=^|\\s)" tag "(?=$|\\s)")))))

(defn parse-custom-color-1 [s {:keys [custom-color-1-tag]}]
  (let [color-format (get-color-pattern custom-color-1-tag) 
        color-found? (re-find color-format s)]
    (if (and (seq custom-color-1-tag) color-found?)
      {:custom-color custom-color-1
       :cleaned-str s}
      {:custom-color nil 
       :cleaned-str s})))

(defn parse-URLs
  "Extract and format URL links"
  [s]
  (str/replace s #"\[([^\]]*?)\]\((.*?)\)" "$1"))

(defn parse-rest [s]
  (-> (or (log-core-call "stripGoogleCalendarSourceSuffix" s) s)
      ;; Remove specific Roam markers (TODO, DONE, etc.)
      (str/replace #"\{\{\[\[TODO\]\]\}\}" "")
      (str/replace #"\{\{\[\[DONE\]\]\}\}" "")

      ;; Remove wiki links
      (str/replace #"\[\[(.*?)\]\]" "$1")

      ;; Remove other special formatting (bold, italic, etc.)
      (str/replace #"\*\*(.*?)\*\*" "$1")
      (str/replace #"\_\_(.*?)\_\_" "$1")
      (str/replace #"\^\^(.*?)\^\^" "$1")

      ;; Remove embeds (idiot version, but works)
      (str/replace #"\{\{(\[\[)?embed(\]\])?\:" "")
      (str/replace #"\}\}" "")


      ;; Trim double spaces and whitespace. Structural dividers are filtered
      ;; by the shared task-instance classifier before this renderer runs.
      (str/replace #"\s\s" " ")
      (str/trim)))

(defn parse-row-params [block-map settings clock-context]
  (let [s (:s block-map)
        cleaned-str (parse-URLs s) ;; remove URLs – it has to start with this, because URLs can contain other markers
        {:keys [custom-color cleaned-str]} (parse-custom-color-1 cleaned-str settings)
        {:keys [range warning cleaned-str]} (parse-time-range cleaned-str settings)
        {:keys [duration cleaned-str]} (parse-duration cleaned-str settings)
        {:keys [done-at cleaned-str]} (parse-done-time cleaned-str)
        {:keys [done cleaned-str]} (parse-DONE cleaned-str)
        ;; A flexible completed task uses one condensed Actual slice when the
        ;; displayed day has valid closed CLOCK records. Fixed events retain
        ;; their explicit range, and Planned remains the fallback.
        actual-summary (when (and done (nil? range))
                         (log-core-call "completedTaskClockSummary"
                                        {:taskUid (:uid block-map)
                                         :entries (:entries clock-context)
                                         :dayStartMs (:dayStartMs clock-context)
                                         :dayEndMs (:dayEndMs clock-context)}))
        actual-duration (:actualMinutes actual-summary)
        last-clock-end (:latestEndMinutes actual-summary)
        done-slice (log-core-call "historicalDoneSlice"
                                   {:done done
                                    :doneAt done-at
                                    :duration duration
                                    :defaultDuration (:default-duration settings)
                                    :actualDuration actual-duration
                                    :lastClockEnd last-clock-end})
        description (parse-rest cleaned-str)
        event-type (if range :meeting :todo)]
    (-> {:description description
         :duration (if (and done-slice (nil? range))
                     (:duration done-slice)
                     duration)
         :uid (:uid block-map)
         ;; Fixed events keep their explicit range after completion so the
         ;; full-day event denominator remains stable. Flexible DONE tasks use
         ;; their completion marker to reconstruct a historical slice.
         :start (if range (first range) (:start done-slice))
         :end (if range (second range) (:end done-slice))
         :done done
         :warning warning
         :bg-color custom-color
         :done-at (if done (or done-at last-clock-end) nil)
         :duration-source (:durationSource done-slice)
         :actual-minutes (when (= "actual" (:durationSource done-slice)) actual-duration)
         :clock-session-count (:sessionCount actual-summary)
         :planned-duration duration
         :status-origin (get-in block-map [:task-instance :statusOrigin])}
        (assoc event-type true))))

;; --------------- fill day with events and todos ----------------------

(defn fill-day [events workday-start workday-end plan-from-time]
  "Builds the visible timeline through the tested JS scheduler. Fixed events
   stay visible even after they have passed today; flexible work is scheduled
   only from the current planning cursor and overflow is returned separately
   by calculate-capacity."
  (let [todo-events (vec (filter #(= true (:todo %)) events))
        meeting-events (vec (filter #(= true (:meeting %)) events))
        pending-todos (vec (filter #(not (:done %)) todo-events))
        scheduler-input (log-core-call "scheduleTasks"
                                        {:startMinutes workday-start
                                         :endMinutes workday-end
                                         :nowMinutes plan-from-time
                                         :tasks pending-todos
                                         :fixedEvents meeting-events})
        scheduled-by-uid (into {} (map (juxt :uid identity) (:scheduledTasks scheduler-input)))
        scheduled-todos (keep (fn [todo]
                                (when-let [planned (get scheduled-by-uid (:uid todo))]
                                  (assoc todo
                                         :start (:start planned)
                                         :end (:end planned)
                                         :duration (:duration planned))))
                              pending-todos)
        visible-meetings (->> meeting-events
                              (filter #(and (:start %) (:end %)
                                            (> (:end %) workday-start)
                                            (< (:start %) workday-end)))
                              (map #(assoc %
                                           :start (max workday-start (:start %))
                                           :end (min workday-end (:end %))))
                              (filter #(< (:start %) (:end %))))
        occupied (sort-by :start (concat visible-meetings scheduled-todos))]
    (loop [items occupied
           cursor workday-start
           result []]
      (if-let [event (first items)]
        (let [event-start (:start event)
              event-end (:end event)
              result (if (> event-start cursor)
                        (conj result {:freetime true :start cursor :end event-start})
                        result)
              result (if (>= event-end cursor)
                        (conj result event)
                        result)]
          (recur (rest items) (max cursor event-end) result))
        (if (< cursor workday-end)
          (conj result {:freetime true :start cursor :end workday-end})
          result)))))


;; --------------- slice component ----------------------

(defn bent-line-component
  [legend-start-x legend-start-y text-x text-y color at-vertex? on-left? connector-knee-x connector-rail-x]
  (let [fallback-middle-x (/ (+ legend-start-x text-x) 2)
        knee-x (or connector-knee-x fallback-middle-x)
        rail-x (or connector-rail-x text-x)]
    [:g
     [:path {:d (str "M " legend-start-x "," legend-start-y
                     " L " knee-x "," legend-start-y
                     " L " rail-x "," text-y
                     " L " text-x "," text-y)
             :class "nautilus-log-link-line"
             :stroke color
             :stroke-width "1.5px"
             :stroke-linecap "round"
             :stroke-linejoin "round"
             :fill "none"}]]))

(defn calculate-coordinates
  "Calculates the x and y coordinates based on angle, radius, and center position."
  [angle radius center]
  (let [radians (angle->rad angle)]
    [(+ (:center-x center) (* (cos radians) radius))
     (- (:center-y center) (* (sin radians) radius))]))

(defn create-arc-path
  "Constructs the SVG path for the arc based on start and end angles and radii."
  [start-angle end-angle inner-radius outer-radius center]
  (let [start-radians (angle->rad start-angle)
        end-radians (angle->rad end-angle)
        start-coord-outer (calculate-coordinates start-angle outer-radius center)
        end-coord-outer (calculate-coordinates end-angle outer-radius center)
        start-coord-inner (calculate-coordinates start-angle inner-radius center)
        end-coord-inner (calculate-coordinates end-angle inner-radius center)
        large-arc-flag (if (>= (pos-sweep-angle start-radians end-radians) pi) 1 0) #_(if (>= (abs (- end-angle start-angle)) 180) 1 0)]
    (str "M" (first start-coord-outer) "," (second start-coord-outer)
         " A" outer-radius "," outer-radius " 0 " large-arc-flag " 1 " (first end-coord-outer) "," (second end-coord-outer)
         " L" (first end-coord-inner) "," (second end-coord-inner)
         " A" inner-radius "," inner-radius " 0 " large-arc-flag " 0 " (first start-coord-inner) "," (second start-coord-inner)
         "Z")))

(defn slice
  "Draws and colors the slice section according to the specified parameters"
  [[start-angle end-angle inner-radius outer-radius center settings]
   & {:keys [bg-color fill-opacity border-color legend-color legend-rect text timestamp hour-font-size stroke-dasharray font-weight shaky done? task-start-min task-end-min past?]}]
  (let [start-radians (angle->rad (+ start-angle (shake-if shaky)))
        end-radians (angle->rad (+ end-angle (shake-if shaky)))
        mid-radians (if (and task-start-min task-end-min)
                      (pos-sweep-angle-mid (angle->rad (min->angle task-start-min)) (angle->rad (min->angle task-end-min)))
                      (pos-sweep-angle-mid start-radians end-radians))
        inner-radius (+ inner-radius (shake-if shaky))
        line-outer-radius (if (and task-start-min task-end-min)
                            (+ (spiral-outer-radius (/ (+ task-start-min task-end-min) 2) settings) (shake-if shaky))
                            (+ outer-radius (shake-if shaky)))
        outer-radius (+ outer-radius (shake-if shaky))
        [center-x center-y] [(:center-x center) (:center-y center)]
        bent-line-gap 5 
        [legend-line-start-x legend-line-start-y] [(+ (* (cos mid-radians) (+ bent-line-gap line-outer-radius)) center-x) (- center-y (* (sin mid-radians) (+ line-outer-radius bent-line-gap)))]
        [legend-x legend-y] [(:x legend-rect) (:y legend-rect)]
        [legend-w legend-h] [(:w legend-rect) (:h legend-rect)]
        legend-radians (- (:real-rect-radians legend-rect))
        at-vertex? (at-vertex legend-radians)
        [legend-line-end-x legend-line-end-y]
        (if at-vertex?
          [(+ legend-x (/ legend-w 2)) (+ legend-y (if (< legend-radians 0) 0 legend-h))] ; pokud je legenda na vrcholu, tak je konec čáry uprostřed legendy
          (cond
            (and (< legend-radians pi) (> legend-radians (/ pi 2))) [(+ legend-x legend-w bent-line-gap) (+ legend-y (* legend-h (sin legend-radians)))] ; levý horní
            (and (< legend-radians (/ pi 2)) (> legend-radians 0)) [legend-x (+ legend-y (/ legend-h 2) (* legend-h (/ (sin legend-radians) 2)))] ; pravý horní
            (and (< legend-radians 0) (> legend-radians (- (/ pi 2)))) [legend-x (+ legend-y (* legend-h (/ (cos legend-radians) 2)))] ; pravý dolní
            :else [(+ legend-x legend-w bent-line-gap) (+ legend-y (* (/ (+ (sin legend-radians) 1) 2) legend-h))])) ; levý dolní
        time-text-x (+ center-x (* (cos start-radians) (- outer-radius 10)))
        time-text-y (- center-y (* (sin start-radians) (- outer-radius 10)))
        border-color (if (= border-color nil) "none" border-color)
        stroke-dasharray (if (= stroke-dasharray nil) "none" stroke-dasharray)
        bg-color (if (= bg-color nil) "rgba(255,255,255,0)" bg-color)
        legend-color (or legend-color (update-opacity-str bg-color "1"))
        font-weight (if font-weight font-weight "normal")
        path (create-arc-path start-angle end-angle inner-radius outer-radius center)
        debug? @debug-state-atom                                       
        dbg-radians-txt (if debug? (str "slc:" (round2 start-radians)  
                                        "–>" (round2 end-radians) "/ leg:" (round2 legend-radians)) "") 
        on-left? (or (<= legend-radians (- (/ pi 2))) (>= legend-radians (/ pi 2)))] 
    [:g {:class (when past? "nautilus-log-grid-past")}
     (when @debug-state-atom  [:circle {:cx center-x :cy center-y :r 4 :fill "red"}])              
     ;; ⤵ this is the main component - slice

     [:path
      {:d path
       :class "nautilus-log-slice"
       :style {:--pb-delay (str (* (/ (or task-start-min 0) 1440.0) 6.0) "s")}
       :stroke-dasharray stroke-dasharray
       :fill bg-color
       :fill-opacity (or fill-opacity 1)
       :stroke border-color}]
     ;; ⤵ adds an event legend
     (when text
       [:g {:style {:--pb-delay (str (* (/ (or task-start-min 0) 1440.0) 6.0) "s")}
             :class "nautilus-log-slice-group"}
        [bent-line-component legend-line-start-x legend-line-start-y legend-line-end-x legend-line-end-y legend-color at-vertex? on-left?
         (:connector-knee-x legend-rect) (:connector-rail-x legend-rect)]
        [:text {:x (if at-vertex? legend-line-end-x (+ legend-line-end-x (if on-left? (- bent-line-gap) bent-line-gap))) 
                :y (+ legend-y legend-h)
                :text-anchor (if at-vertex?
                               "middle"
                               (if on-left? "end" "start"))
                :alignment-baseline "baseline"
                :font-weight font-weight
                :text-decoration "none"
                :fill (if-not done? legend-color "var(--nautilus-log-completed)")}
         (if debug? (str dbg-radians-txt)
             (or (:label-text legend-rect) text))
         ]])     
     (when (seq timestamp)
       ;; ⤵ adds a clock label for the snail template
       [:text  {:x time-text-x :y time-text-y :font-family font-family
                :style {:font-size (str (or hour-font-size (- font-size 3)) "px")}
                :class "nautilus-log-hour-label" :fill "var(--nautilus-log-chart-muted)"
                :text-anchor "middle" :dominant-baseline "central"}
        (if debug? (str (round2 start-radians) " / " start-angle) timestamp)])]))

(defn past-time-overlay-component [inner-radius center settings elapsed-through-minutes]
  (let [start (:workday-start settings)
        end (min (:workday-end settings) elapsed-through-minutes)]
    [:g {:class "nautilus-log-past-overlay" :aria-hidden "true"}
     (when (< start end)
       [:path {:d (shell-path start end inner-radius center settings)}])]))

(defn past-unplanned-overlay-component [occupied-events inner-radius center settings elapsed-through-minutes plot-scale]
  (r/with-let [pattern-id (str "nautilus-log-past-" (random-uuid))]
    (let [scale (or plot-scale 1)
          gaps (or (log-core-call "pastUnplannedGroups"
                                  {:startMinutes (:workday-start settings)
                                   :endMinutes (:workday-end settings)
                                   :nowMinutes elapsed-through-minutes :occupiedEvents occupied-events}) [])]
      [:g {:class "nautilus-log-unplanned-overlay" :aria-hidden "true"}
       [:defs
        [:pattern {:id pattern-id :width (/ 6 scale) :height (/ 6 scale)
                   :patternUnits "userSpaceOnUse" :patternTransform "rotate(45)"}
         [:rect {:width (/ 6 scale) :height (/ 6 scale) :fill "var(--nautilus-log-unplanned-fill)"}]
         [:line {:x1 0 :y1 0 :x2 0 :y2 (/ 6 scale)
                 :stroke "var(--nautilus-log-unplanned-stripe)" :stroke-width (/ 0.6 scale)}]]]
       (for [{:keys [start end key]} gaps]
         ^{:key key}
         [:path {:d (shell-path start end inner-radius center settings)
                 :fill (str "url(#" pattern-id ")")}])])))

(defn past-record-texture-defs [material-id inner-radius center settings elapsed-through-minutes plot-scale]
  (let [scale (or plot-scale 1)
        start (:workday-start settings)
        end (min (:workday-end settings) elapsed-through-minutes)]
    [:defs
     ;; Unlike the gap pattern, this is transparent between lines: retain every
     ;; record's existing fill/gradient and communicate elapsed time only.
     [:pattern {:id (str material-id "-past-texture") :class "nautilus-log-past-record-pattern"
                :width (/ 6 scale) :height (/ 6 scale)
                :patternUnits "userSpaceOnUse" :patternTransform "rotate(45)"}
      [:line {:x1 0 :y1 0 :x2 0 :y2 (/ 6 scale)
              :stroke "var(--nautilus-log-chart-muted)"
              :stroke-width (/ 0.6 scale) :stroke-opacity 0.12}]]
     [:clipPath {:id (str material-id "-past-sweep") :class "nautilus-log-past-record-clip"
                 :clipPathUnits "userSpaceOnUse" :data-start start :data-end end}
      (when (< start end)
        [:path {:d (shell-path start end inner-radius center settings)}])]]))

(defn snail-blueprint-component [color inner-radius center settings _show-elapsed? _elapsed-through-minutes & [hour-step plot-scale]]
  (let [scale (or plot-scale 1)
        hour-size (/ (if (> (or hour-step 1) 1) 9 10) scale)
        grid (log-core-call "shellGrid" (assoc (shell-options center settings inner-radius)
                                               :hourStep (or hour-step 1) :plotScale scale))]
    [:g {:class "nautilus-log-grid" :aria-hidden "true" :pointer-events "none"}
     [:path {:class "nautilus-log-shell-outline" :d (:path grid) :fill "none" :stroke color}]
     (for [{:keys [minute major label x1 y1 x2 y2 labelX labelY]} (:ticks grid)]
       ^{:key minute}
       [:g
        [:line {:class (str "nautilus-log-shell-tick" (when major " is-major"))
                :x1 x1 :y1 y1 :x2 x2 :y2 y2 :vector-effect "non-scaling-stroke"}]
        (when label
          [:text {:class "nautilus-log-hour-label" :x labelX :y labelY
                  :style {:font-size (str hour-size "px")} :fill "var(--nautilus-log-chart-muted)"
                  :text-anchor "middle" :dominant-baseline "central"} label])])]))

(defn central-label-component [[first-row _] center center-now-label & [plot-scale copy]]
  (let [[center-x center-y] [(:center-x center) (:center-y center)]
        scale (or plot-scale 1)
        small? (< scale 0.6)
        date-parts (re-find #"^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$" first-row)
        short-date (when (and (< scale 0.9) date-parts)
                     (str (subs (nth date-parts 1) 0 (min 3 (count (nth date-parts 1)))) " " (nth date-parts 2)))
        rows (cond short-date [short-date]
                   (and (not center-now-label) (< scale 0.9) (str/includes? first-row " ")) (str/split first-row #"\s+" 2)
                   :else [first-row])
        two? (= 2 (count rows))
        date-size (if center-now-label (if small? 8.5 9) (if small? 9.5 11))
        time-size (min 16 (max 9 (/ (- (* 2 snail-inner-radius scale) 8) 3.2)))
        common {:x center-x :text-anchor "middle" :dominant-baseline "central"}]
    [:g {:class "nautilus-log-center-date" :aria-label (str first-row (when center-now-label (str " " center-now-label)))}
     (for [[index row] (map-indexed vector rows)]
       ^{:key index}
       [:text (assoc common :y (+ center-y (/ (+ (if center-now-label (if small? -7 -16) (if two? -6 0)) (* index 12)) scale))
                     :fill "var(--nautilus-log-chart-muted)" :font-weight "500"
                     :font-size (str (/ date-size scale))) row])
     (when center-now-label
       [:text (assoc common :y (+ center-y (/ (if small? 6 3) scale))
                     :class "nautilus-log-center-now" :font-weight "400"
                     :font-size (str (/ time-size scale))) center-now-label])]))

(defn calculate-slice-params [event index elapsed-page? interactive? timeline-minute settings]
  (let [outer-radius (spiral-outer-radius (:start event) settings)
        start-angle (min->angle (:start event))
        end-angle (min->angle (:end event))
        todo? (:todo event)
        done-at (:done-at event)
        done? (if (:done event) true false)
        meeting? (:meeting event)
        expired? (and elapsed-page? meeting? (>= timeline-minute (:end event)))
        current? (= true (log-core-call "isCurrentPlannedTask"
                                         {:event event
                                          :nowMinutes timeline-minute
                                          :dailyPage interactive?}))
        past-status (log-core-call "pastItemStatus"
                                   {:event event
                                    :nowMinutes timeline-minute
                                    :dailyPage elapsed-page?})
        todo-bg-color (or (:bg-color event) task-fill-color)
        meeting-color (or (:bg-color event) meeting-fill-color)
        appearance (log-core-call "chartRecordAppearance"
                                  {:event event :nowMinutes timeline-minute :interactive interactive? :showElapsed elapsed-page?})]
    {:start-angle start-angle
     :end-angle end-angle
     :bg-color (or (:fill appearance)
                   (cond done? completed-fill-color
                         (= "event" past-status) past-event-fill-color
                         meeting? meeting-color todo? todo-bg-color :else nil))
     :fill-opacity (or (:fillOpacity appearance) 1)
     :visual-phase (:phase appearance)
     :current-event? (:currentEvent appearance)
     :done done?
     :outer-radius outer-radius
     :meeting? meeting?
     :expired? expired?
     :past-status past-status
     :current? current?}))

(defn get-hour-boundaries [start-min end-min]
  (let [first-bound (* (quot (+ start-min 59) 60) 60)
        first-bound (if (<= first-bound start-min) (+ first-bound 60) first-bound)]
    (range first-bound end-min 60)))

(defn event-slice-component [event index legend-rect labels-visible? inner-radius elapsed-page? interactive? timeline-minute center settings conflict? hover-enabled? hover-info-state copy]
  (let [{:keys [bg-color done meeting? expired? past-status current?]} (calculate-slice-params event index elapsed-page? interactive? timeline-minute settings)
        legend-color (cond
                       (= "completed" past-status) "var(--nautilus-log-completed)"
                       (and meeting? (nil? (:bg-color event))) "var(--nautilus-log-event)"
                       (and (:todo event) (not done) (nil? (:bg-color event))) task-legend-color
                       :else nil)
        description (:description event)
        uid (:uid event)
        actionable? (= true (:todo event))
        start-min (:start event)
        end-min (:end event)
        kind-label (when hover-enabled?
                     (str (when done (str (get-in copy [:tooltips :completed]) " · "))
                          (get-in copy [:tooltips (if meeting? :event :task)])))
        action-hint (when actionable? (get-in copy [:tooltips :locateTask]))
        tooltip-info (when hover-enabled?
                       (assoc (timeline-tooltip-info description kind-label start-min end-min action-hint)
                              :uid uid
                              :detail-kind :event
                              :detail-signature (event-detail-signature event)
                              :tone (cond
                                      done "completed"
                                      meeting? "event"
                                      :else "task")))
        boundaries (get-hour-boundaries start-min end-min)
        segments (loop [curr start-min
                        bounds boundaries
                        segs []]
                   (if (empty? bounds)
                     (if (< curr end-min)
                       (conj segs [curr end-min])
                       segs)
                     (recur (first bounds) (rest bounds) (conj segs [curr (first bounds)]))))]
    (into [:g (merge {:class (str "nautilus-log-event-slice-group"
                            (when hover-enabled? " nautilus-log-event-slice-group--interactive")
                            (when actionable? " nautilus-log-event-slice-group--actionable")
                            (case past-status
                              "completed" " nautilus-log-past--completed"
                              "event" " nautilus-log-past--event"
                              "")
                            (when conflict? " nautilus-log-event-conflict")
                            (when current? " nautilus-log-current-task"))
                    :data-past-status past-status
                    :aria-current (when current? "true")}
                   (when hover-enabled?
                     {:aria-label (:aria-label tooltip-info)
                      :tab-index 0
                      :focusable "true"
                      :on-mouse-enter #(show-hover-tooltip! hover-info-state :pointer tooltip-info %)
                      :on-focus #(show-hover-tooltip! hover-info-state :focus tooltip-info %)})
                   (if actionable?
                     {:aria-label (or (:aria-label tooltip-info)
                                      (str description ". " action-hint))
                      :role "link"
                      :tab-index 0
                      :focusable "true"
                      :on-click #(locate-plan-task! uid hover-info-state %)
                      :on-key-down #(task-keydown! uid hover-info-state %)}
                     (when hover-enabled? {:role "img"})))]
          (map-indexed
           (fn [idx [s e]]
             (let [start-angle (min->angle s)
                   end-angle (min->angle e)
                   seg-inner-radius (spiral-cell-inner-radius s settings inner-radius)
                   seg-outer-radius (spiral-outer-radius s settings)]
               [slice
                [start-angle end-angle seg-inner-radius seg-outer-radius center settings]
                :bg-color bg-color
                :legend-color legend-color
                :text (if (and labels-visible? (= idx 0) legend-rect) description nil)
                :shaky shaky
                :done? done
                :font-weight "500"
                :legend-rect (if (= idx 0) legend-rect nil)
                :task-start-min start-min
                :task-end-min end-min]))
           segments))))

(defn label-track-map [events]
  (let [labels (mapv #(select-keys % [:uid :start :end]) events)
        placed (or (log-core-call "placeLabelTracks" {:labels labels :maxTracks 3}) [])]
    (into {} (map (juxt :uid :track) placed))))

(defn events->slices
  "Returns SVG slices and only the labels that fit inside the fixed frame."
  ([events elapsed-page? interactive? timeline-minute center settings labels-visible? hover-enabled? hover-info-state copy]
   (events->slices events elapsed-page? interactive? timeline-minute center settings labels-visible? hover-enabled? hover-info-state copy []))
  ([events elapsed-page? interactive? timeline-minute center settings labels-visible? hover-enabled? hover-info-state copy init-rects]
   (let [events (vec (filter #(not= true (:freetime %)) events))
         track-map (label-track-map events)
         conflict-uids (set (or (log-core-call "overlappingFixedEventUids" {:events events}) []))]
   (loop [i 0
          events events
          rects init-rects
          all-slice-components [:g]]
    (if-let [event (first events)]
      (let [mid-radians (pos-sweep-angle-mid
                         (angle->rad (min->angle (:start event)))
                         (angle->rad (min->angle (:end event))))
            mid-minute (/ (+ (:start event) (:end event)) 2)
            source-radius (spiral-outer-radius mid-minute settings)
            anchor-y (- (:center-y center) (* (sin mid-radians) (+ source-radius 5)))
            text (:description event)
            radius (+ (nth snail-blueprint-outer-radiuses (spiral-profile-index (:start event) settings))
                      (* 18 (or (get track-map (:uid event)) 0)))
            new-rect (when labels-visible?
                       (get-legend-rect rects text mid-radians radius center settings (:start event) anchor-y))
            next-rects (if new-rect (conj rects new-rect) rects)]
        (println?debug "RADIUS INSIDE EVENTS-SLICES: " radius)              
        (recur (inc i) (rest events) next-rects
               (conj all-slice-components
                     (event-slice-component event i new-rect labels-visible? snail-inner-radius elapsed-page? interactive? timeline-minute center settings
                                            (contains? conflict-uids (:uid event)) hover-enabled? hover-info-state copy))))
      [all-slice-components rects])))))

(defn spiral-grid-bounds [center settings]
  (let [segments (or (log-core-call "hourlyGridSegments"
                                    {:startMinutes (:workday-start settings)
                                     :endMinutes (:workday-end settings)})
                     [])
        points (mapcat (fn [{:keys [start end]}]
                         (let [radius (spiral-outer-radius start settings)]
                           [(calculate-coordinates (min->angle start) radius center)
                            (calculate-coordinates (min->angle end) radius center)]))
                       segments)]
    (if (seq points)
      {:left (apply min (map first points))
       :right (apply max (map first points))
       :top (apply min (map second points))
       :bottom (apply max (map second points))}
      (let [radius (apply max (map outer-radius-at (range (count snail-blueprint-outer-radiuses))))]
        {:left (- (:center-x center) radius)
         :right (+ (:center-x center) radius)
         :top (- (:center-y center) radius)
         :bottom (+ (:center-y center) radius)}))))

(defn events->new-dimensions
  "Returns a new center and width so that events can be aligned"
  [events center settings]
  (let [center-x (:center-x center)
        center-y (:center-y center)
        visible-events (vec (filter #(not= true (:freetime %)) events))
        track-map (label-track-map visible-events)
        grid-bounds (spiral-grid-bounds center settings)]
    (loop [i 0
           events visible-events
           rects []
           left-min (:left grid-bounds)
           right-max (:right grid-bounds)
           top-min (:top grid-bounds)
           bottom-max (:bottom grid-bounds)]
      (if-let [event (first events)]
        (let [mid-radians (pos-sweep-angle-mid
                           (angle->rad (min->angle (:start event)))
                           (angle->rad (min->angle (:end event))))
              mid-minute (/ (+ (:start event) (:end event)) 2)
              source-radius (spiral-outer-radius mid-minute settings)
              anchor-y (- (:center-y center) (* (sin mid-radians) (+ source-radius 5)))
              text (:description event)
              radius (+ (nth snail-blueprint-outer-radiuses (spiral-profile-index (:start event) settings))
                        (* 18 (or (get track-map (:uid event)) 0)))
              new-rect (assoc (get-legend-rect rects text mid-radians radius center settings (:start event) anchor-y)
                              :event-uid (:uid event))]
          (recur (inc i) (rest events) (conj rects new-rect) (min left-min (:x new-rect)) (max right-max (+ (:x new-rect) (:w new-rect))) (min top-min (:y new-rect)) (max bottom-max (+ (:y new-rect) (:h new-rect)))))
        [(+ reserve (- center-x left-min))
         (+ reserve (- right-max left-min))
         (+ reserve (- center-y top-min))
         (+ (* 3 reserve) (- bottom-max top-min) (when (< (:workday-start settings) 420) reserve))
         rects])))) ;; when the workday starts before 7:00, the snail has to get more space below

(defn split-and-trim [page-title n]
  (map #(subs % 0 (min n (count %))) (str/split page-title #"," 2)))

(defn compact-item-tone [event]
  (cond
    (:bg-color event) "urgent"
    (:meeting event) "event"
    :else "task"))

(defn compact-event-list [events copy compact-open-state hover-info-state]
  (let [items (->> events
                   (filter #(and (not= true (:freetime %))
                                 (number? (:start %))
                                 (number? (:end %))))
                   (sort-by (juxt :start :end))
                   vec)
        item-label (if (= 1 (count items))
                     (get-in copy [:panels :item])
                     (get-in copy [:panels :items]))]
    [:details {:class "nautilus-log-compact-details"
               :open @compact-open-state
               :on-toggle #(let [next-open? (.-open (.-currentTarget %))]
                             (when (not= next-open? @compact-open-state)
                               (reset! compact-open-state next-open?)))}
     [:summary {:class "nautilus-log-compact-summary"}
      (str (get-in copy [:panels :schedule]) " · " (count items) " " item-label)]
     [:ol {:class "nautilus-log-compact-list"
           :aria-label "Nautilus Log scheduled items"}
      (for [[index event] (map-indexed vector items)]
        ^{:key (str (:uid event) ":" (:start event) ":" index)}
        [:li (merge {:class (str "nautilus-log-compact-item"
                                  (when (:done event) " nautilus-log-compact-item--done")
                                  (when (:todo event) " nautilus-log-compact-item--actionable"))
                     :title (:description event)
                     :aria-label (when (:done event)
                                   (str (:description event) ". " (get-in copy [:tooltips :completed])))}
                    (when (:todo event)
                      {:role "link"
                       :tab-index 0
                       :aria-label (str (:description event) ". "
                                        (when (:done event) (str (get-in copy [:tooltips :completed]) ". "))
                                        (get-in copy [:tooltips :locateTask]))
                       :on-click #(locate-plan-task! (:uid event) hover-info-state %)
                       :on-key-down #(task-keydown! (:uid event) hover-info-state %)}))
         [:i {:class (str "nautilus-log-compact-dot nautilus-log-compact-dot--" (compact-item-tone event))
              :aria-hidden "true"}]
         [:time {:class "nautilus-log-compact-time"}
          (str (minutes->time (:start event)) "–" (minutes->time (:end event)))]
         [:span {:class "nautilus-log-compact-title"}
          (when (:done event) [:span {:aria-hidden "true"} "✓ "])
          (:description event)]])]]))

(defn available-slot-tooltip-info [slot copy _center]
  (let [slot-label (get-in copy [:tooltips (if (:availableNow slot) :availableNow :available)])
        time-range (str (minutes->time (:start slot)) "–" (minutes->time (:end slot)))
        duration (duration-label (:duration slot))]
    {:title slot-label
     :meta (str time-range " · " duration)
     :uid (:key slot)
     :detail-kind :available
     :tone "available"
     :aria-label (str slot-label ". " time-range ". " duration)}))

(defn past-gap-tooltip-info [gap copy]
  (let [title (get-in copy [:tooltips :pastGap])
        summary (get-in copy [:tooltips :pastGapSummary])
        explanation (get-in copy [:tooltips :pastGapExplanation])
        time-range (str (minutes->time (:start gap)) "–" (minutes->time (:end gap)))
        duration (duration-label (:duration gap))]
    {:title title
     :summary-meta (str summary " · " time-range " · " duration)
     :meta (str summary " · " time-range " · " duration " · " explanation)
     :uid (:key gap)
     :detail-kind :past-gap
     :tone "past-gap"
     :aria-label (str title ". " summary ". " time-range ". " duration ". " explanation)}))

(defn past-gap-hit-component [gaps inner-radius center settings hover-info-state copy active-uid]
  [:g {:class "nautilus-log-past-gap-hits"}
   (for [gap gaps
         :let [tooltip-info (past-gap-tooltip-info gap copy)]]
     ^{:key (:key gap)}
     [:g {:class (str "nautilus-log-past-gap"
                      (when (= (:key gap) active-uid) " nautilus-log-past-gap--active"))
          :data-past-gap-key (:key gap)
          :data-past-gap-start (:start gap)
          :data-past-gap-end (:end gap)
          :aria-label (:aria-label tooltip-info)
          :aria-pressed (if (= (:key gap) (get-in @hover-info-state [:expanded :uid])) "true" "false")
          :role "button"
          :tab-index 0
          :focusable "true"
          :on-mouse-enter #(show-hover-tooltip! hover-info-state :pointer tooltip-info %)
          :on-focus #(show-hover-tooltip! hover-info-state :focus tooltip-info %)
          :on-click #(activate-detail! hover-info-state tooltip-info %)
          :on-key-down #(inspection-keydown! hover-info-state tooltip-info %)}
      [:path {:class "nautilus-log-past-gap-hit"
              :d (shell-path (:start gap) (:end gap) inner-radius center settings)
              :vector-effect "non-scaling-stroke"}]])])

(defn available-slot-component [slots inner-radius center settings hover-info-state copy]
  [:g {:class "nautilus-log-available-slots"}
     (for [slot slots
           :let [tooltip-info (available-slot-tooltip-info slot copy center)]]
       ^{:key (:key slot)}
       [:g {:class (str "nautilus-log-available-slot"
                        (when (:availableNow slot) " nautilus-log-available-slot--now"))
            :aria-label (:aria-label tooltip-info)
            :role "img"
            :tab-index 0
            :focusable "true"
            :on-mouse-enter #(show-hover-tooltip! hover-info-state :pointer tooltip-info %)
            :on-focus #(show-hover-tooltip! hover-info-state :focus tooltip-info %)}
        [:path {:class "nautilus-log-available-slot-hit"
                :d (shell-path (:start slot) (:end slot) inner-radius center settings)
                :vector-effect "non-scaling-stroke"}]])])

(defn chart-record-label [record copy params]
  (let [label (:label record) anchor (:anchor record)
        left? (= "left" (:side label))
        highlight-x (- (:textX label) (if left? (+ (:inkWidth label) 5) 5))]
    [:g {:class "nautilus-log-record-annotation"}
     [:path {:class "nautilus-log-record-leader" :d (:connector label) :fill "none" :pointer-events "none"}]
     (when anchor
       [:circle {:class "nautilus-log-record-anchor" :cx (:x anchor) :cy (:y anchor) :r 1.7
                 :aria-hidden "true" :pointer-events "none"}])
     [:g {:class "nautilus-log-record-label"}
      [:rect {:class "nautilus-log-label-hit" :x (:x label) :y (:y label)
              :width (:width label) :height (:height label) :fill "transparent"
              :pointer-events "all" :aria-hidden "true"}]
      [:rect {:class "nautilus-log-label-highlight" :x highlight-x :y (inc (:y label))
              :width (+ (:inkWidth label) 10) :height (- (:height label) (:metadataHeight label) 2)
              :rx 3 :aria-hidden "true" :pointer-events "none"}]
      [:text {:class "nautilus-log-record-title" :text-anchor (:align label)
              :data-label-side (:side label)
              :style {:white-space "pre" :font-size (str (:fontSize label) "px")} :font-weight "500"}
       (for [[index line] (map-indexed vector (:lines label))]
         ^{:key index}
         [:tspan {:x (:textX label) :y (+ (:textY label) (* index (:lineHeight label)))} line])]
      (when (or (:current? params) (:current-event? params))
        [:text {:class "nautilus-log-record-current" :x (:textX label) :y (:metadataY label)
                :text-anchor (:align label) :font-size (:metadataFontSize label) :pointer-events "none"}
         (or (get-in copy [:tooltips (if (:current-event? params) :currentEvent :currentTask)])
             (if (:current-event? params) "Current event" "Current task"))])]]))

(defn estimated-completion? [event]
  (contains? #{"estimated-allocation" "completion-estimate"} (:time-claim event)))

(defn estimated-outline-component [records center settings active-uid show-done?]
  [:g {:class "nautilus-log-estimated-outlines" :aria-hidden "true" :pointer-events "none"
       :visibility (when-not show-done? "hidden")}
   (for [record records
         :when (estimated-completion? (:event record))]
     ^{:key (:uid record)}
     [:g {:data-estimate-outline-for (:uid record)
          :class (str "nautilus-log-estimated-outline" (when (= active-uid (:uid record)) " is-active"))}
      [:path {:d (shell-path (get-in record [:event :start]) (get-in record [:event :end]) snail-inner-radius center settings)
              :vector-effect "non-scaling-stroke"}]])])

(defn chart-scene-record [record index frame settings timeline-state show-done? hover-info-state copy conflicts active-uid material-id]
  (let [event (:event record)
        timed? (= "timed" (:kind record))
        uid (:uid event)
        hidden? (and (:done event) (not show-done?))
        actionable? (boolean (:todo event))
        info (chart-record-info event copy)
        center {:center-x (get-in frame [:center :x]) :center-y (get-in frame [:center :y])}
        scale (:plotScale frame)
        transform (str "translate(" (:center-x center) " " (:center-y center) ") scale(" scale
                       ") translate(" (- (:center-x center)) " " (- (:center-y center)) ")")
        params (when timed? (calculate-slice-params event index (:showElapsed timeline-state)
                                                   (and (:interactive timeline-state) (:showNow timeline-state))
                                                   (:elapsedThroughMinutes timeline-state) settings))
        surface-path (when timed? (shell-path (:start event) (:end event) snail-inner-radius center settings))
        elapsed? (and timed? (:showElapsed timeline-state)
                      (< (max (:start event) (:workday-start settings))
                         (min (:end event) (:workday-end settings) (:elapsedThroughMinutes timeline-state))))]
    [:g (merge {:class (str "nautilus-log-event-slice-group nautilus-log-event-slice-group--interactive"
                            (when actionable? " nautilus-log-event-slice-group--actionable")
                            (when (:done event) " nautilus-log-record--done")
                            (when (:meeting event) " nautilus-log-record--event")
                            (when (estimated-completion? event) " nautilus-log-record--estimated")
                            (when (:overlaps-planned event) " nautilus-log-record--estimate-overlap")
                            (when (not timed?) " nautilus-log-loose-record")
                            (when (= "unplaced" (:kind record)) " nautilus-log-loose-record--unplaced")
                            (when (contains? conflicts uid) " nautilus-log-event-conflict")
                            (when (:current? params) " nautilus-log-current-task")
                            (when (:current-event? params) " nautilus-log-current-event"))
                :data-task-uid uid :data-record-title (:description event)
                :data-chart-kind (:kind record) :data-time-claim (:time-claim event)
                :data-connection-active (when (= uid active-uid) "true")
                :data-past-status (:past-status params)
                :data-visual-phase (:visual-phase params)
                :data-category (if (:meeting event) "event" "task")
                :style (when (:bg-color event) {"--nautilus-log-record-accent" (update-opacity-str (:bg-color event) "1")})
                :visibility (when hidden? "hidden") :aria-hidden hidden?
                :aria-current (when (or (:current? params) (:current-event? params)) "true")
                :role (if actionable? "link" "img") :tab-index (if hidden? -1 0) :focusable "true"
                :aria-label (:aria-label info)
                :on-mouse-enter #(show-hover-tooltip! hover-info-state :pointer info %)
                :on-focus #(show-hover-tooltip! hover-info-state :focus info %)}
               (when actionable?
                 {:on-click #(locate-plan-task! uid hover-info-state %)
                  :on-key-down #(task-keydown! uid hover-info-state %)}))
     (if timed?
       [:g {:transform transform}
        [:path {:class "nautilus-log-slice"
                :d surface-path
                :fill (:bg-color params) :fill-opacity (:fill-opacity params)
                :vector-effect "non-scaling-stroke"}]
        (when elapsed?
          [:path {:class "nautilus-log-past-record-texture" :data-past-texture-for uid
                  :d surface-path :fill (str "url(#" material-id "-past-texture)")
                  :clip-path (str "url(#" material-id "-past-sweep)")
                  :stroke "none" :pointer-events "none" :aria-hidden "true"}])]
       [:path {:class "nautilus-log-record-marker" :d (:markerPath record)
               :data-marker-shape (get-in record [:marker :shape])
               :aria-hidden "true"
               :style (when (:bg-color event) {:stroke (update-opacity-str (:bg-color event) "1")})}])
     [chart-record-label record copy params]]))

(defn pending-queue-component [queue copy hover-info-state]
  (r/with-let [open-state (r/atom false)]
    (let [items (:items queue)
          title (get-in copy [:panels (if (= "unfinished" (:kind queue)) :unfinished :overflow)])]
      [:details {:class "nautilus-log-pending-queue" :data-queue-kind (:kind queue)
                 :open @open-state
                 :on-toggle (fn [event] (reset! open-state (boolean (.-open (.-currentTarget event)))))
                 :on-click (fn [event] (.stopPropagation event))}
       [:summary
        [:span {:class "nautilus-log-queue-title"} title]
        [:span {:class "nautilus-log-queue-count"} (count items)]
        [:span {:class "nautilus-log-queue-total"} (duration-label (:minutes queue))]]
       [:div {:class "nautilus-log-queue-items"}
        (for [item items]
          ^{:key (:uid item)}
          [:button {:type "button" :class "nautilus-log-queue-item" :data-queued-task-uid (:uid item)
                    :aria-label (str (:description item) ". " (get-in copy [:tooltips :estimated]) " "
                                     (duration-label (:duration item)) ". " (get-in copy [:tooltips :locateTask]))
                    :on-click (fn [event] (locate-plan-task! (:uid item) hover-info-state event))
                    :on-key-down (fn [event] (task-keydown! (:uid item) hover-info-state event))}
           [:span {:class "nautilus-log-queue-item-title"} (:description item)]
           [:span {:class "nautilus-log-queue-item-duration"} (duration-label (:duration item))]])]])))

(defn shell-material-defs [material-id center radius]
  [:defs
   (for [kind ["task" "task-current" "event" "event-current"]]
     ^{:key kind}
     [:radialGradient {:id (str material-id "-" kind) :gradientUnits "userSpaceOnUse"
                       :cx (:center-x center) :cy (:center-y center) :r radius}
      [:stop {:offset "15%" :stop-color (str "var(--nautilus-log-shell-" kind "-inner)")}]
      [:stop {:offset "100%" :stop-color (str "var(--nautilus-log-shell-" kind "-outer)")}]])])

(defn show-events [events-state show-done-atom? _now-time-atom page-title container-width settings copy _compact-open-state hover-info-state _block-uid timeline-state]
  (r/with-let [material-id (str "nautilus-shell-" (random-uuid))]
   (let [[events done-todos _untimed-dones source-events] events-state
        time-radius (apply max (map outer-radius-at (range (count snail-blueprint-outer-radiuses))))
        scene (log-core-call "chartScene"
                            {:items source-events :events (vec (concat events done-todos))
                             :containerWidth container-width :timeRadius time-radius
                             :defaultDuration (:default-duration settings) :relation (:relation timeline-state)
                             :font (str "500 13px " font-family)
                             :currentLabels [(or (get-in copy [:tooltips :currentTask]) "Current task")
                                             (or (get-in copy [:tooltips :currentEvent]) "Current event")]
                             :radiusForMinute (fn [minute] (spiral-outer-radius minute settings))
                             :startMinutes (:workday-start settings) :endMinutes (:workday-end settings)})
        frame (:frame scene)
        frame-width (get-in frame [:viewBox :width])
        frame-height (get-in frame [:viewBox :height])
        center {:center-x (get-in frame [:center :x]) :center-y (get-in frame [:center :y])}
        scale (or (:plotScale frame) 1)
        transform (str "translate(" (:center-x center) " " (:center-y center) ") scale(" scale
                       ") translate(" (- (:center-x center)) " " (- (:center-y center)) ")")
        records (:records scene)
        shown-records (filter #(or @show-done-atom? (not (get-in % [:event :done]))) records)
        all-events (mapv :event shown-records)
        timed-events (mapv :event (filter #(= "timed" (:kind %)) records))
        elapsed-page? (:showElapsed timeline-state)
        interactive? (:interactive timeline-state)
        timeline-minute (:elapsedThroughMinutes timeline-state)
        available-slots (or (when (:showAvailableSlots timeline-state)
                              (log-core-call "availableSlotGroups"
                                             {:events events :startMinutes (:workday-start settings)
                                              :endMinutes (:workday-end settings) :nowMinutes timeline-minute
                                              :clampToNow interactive?})) [])
        past-gaps (or (when elapsed-page?
                        (log-core-call "pastUnplannedGroups"
                                       {:startMinutes (:workday-start settings)
                                        :endMinutes (:workday-end settings)
                                        :nowMinutes timeline-minute
                                        :occupiedEvents timed-events})) [])
        _detail-reconciled (reconcile-detail-state! hover-info-state
                                                   (set (map (juxt :uid event-detail-signature) all-events))
                                                   (set (map :key available-slots))
                                                   (set (map :key past-gaps)))
        active-uid (:uid (active-detail hover-info-state))
        conflicts (set (log-core-call "overlappingFixedEventUids" {:events timed-events}))
        now-visible? (:showNow timeline-state)
        center-now-label (when now-visible? (minutes->time timeline-minute))]
    [:div {:class (str "nautilus-log-workspace nautilus-log-workspace--" (:inspector frame))
           :data-active-connection (when active-uid "true")
           :on-mouse-leave #(clear-detail-on-workspace-exit! hover-info-state %)
           :on-mouse-out #(clear-detail-on-workspace-exit! hover-info-state %)
           :on-blur #(clear-detail-on-workspace-exit! hover-info-state %)
           :on-key-down (fn [event]
                          (when (and (= "Escape" (.-key event))
                                     (= :past-gap (:detail-kind (active-detail hover-info-state))))
                            (dismiss-inspection! hover-info-state event)))}
     [:div {:class "nautilus-log-chart-stage"
            :style {:aspect-ratio (str frame-width " / " frame-height)}}
      [:svg {:viewBox (str "0 0 " frame-width " " frame-height)
             :preserveAspectRatio "xMidYMid meet" :xmlns "http://www.w3.org/2000/svg"
             :class "nautilus-log-svg" :font-family font-family :font-size font-size
             :style {"--nautilus-log-task-future-fill" (str "url(#" material-id "-task)")
                     "--nautilus-log-task-current-fill" (str "url(#" material-id "-task-current)")
                     "--nautilus-log-event-future-fill" (str "url(#" material-id "-event)")
                     "--nautilus-log-event-current-fill" (str "url(#" material-id "-event-current)")}}
       [shell-material-defs material-id center time-radius]
       (when elapsed-page?
         [past-record-texture-defs material-id snail-inner-radius center settings timeline-minute scale])
       [:g {:transform transform}
        [:path {:class "nautilus-log-shell-base" :pointer-events "none" :aria-hidden "true"
                :d (shell-path (:workday-start settings) (:workday-end settings) snail-inner-radius center settings)}]
        (when elapsed-page? [past-time-overlay-component snail-inner-radius center settings timeline-minute])
        (when elapsed-page? [past-unplanned-overlay-component timed-events snail-inner-radius center settings timeline-minute scale])
        (when elapsed-page?
          [past-gap-hit-component past-gaps snail-inner-radius center settings hover-info-state copy active-uid])]
       (for [[index record] (map-indexed vector records)]
         ^{:key (:uid record)}
         [chart-scene-record record index frame settings timeline-state @show-done-atom? hover-info-state copy conflicts active-uid material-id])
       [:g {:transform transform}
        [estimated-outline-component records center settings active-uid @show-done-atom?]
        [snail-blueprint-component snail-template-color snail-inner-radius center settings elapsed-page? timeline-minute (:hourStep frame) scale]
        (when (:showAvailableSlots timeline-state)
          [available-slot-component available-slots snail-inner-radius center settings hover-info-state copy])
        (when now-visible?
          (when-let [needle (log-core-call "shellNeedle"
                                          (assoc (shell-options center settings snail-inner-radius) :minute timeline-minute))]
            [:g {:class "nautilus-log-now-needle" :aria-label (str (get-in copy [:capacity :now]) " " center-now-label)}
             [:line (assoc needle :stroke-linecap "round" :vector-effect "non-scaling-stroke"
                                  :class "nautilus-log-now-needle-line")]
             [:circle {:class "nautilus-log-now-needle-tip" :cx (:x2 needle) :cy (:y2 needle) :r (/ 2 scale)}]]))
        [central-label-component (split-and-trim page-title len-central-legend) center center-now-label scale copy]]]]
     [detail-region-component hover-info-state copy (min 720 container-width)]
     (when-let [queue (:pendingQueue scene)]
       ^{:key (:kind queue)} [pending-queue-component queue copy hover-info-state])])))

(defn add-start-after
  "Adds an end time to events so that tasks placed after the meeting cannot start before it"
  [events]
  (loop [events events
         start-after 0
         result []]
    (if (empty? events)
      result
      (let [event (first events)
            new-start     (if (:meeting event)
                            (:end event)
                            start-after)
            updated-event (if (:todo event)
                            (assoc event :start-after new-start)
                            event)]
        (recur (rest events) new-start (conj result updated-event))))))

(defn apply-plan-session-state! [children-state status-state js-state]
  (let [state (js->clj js-state :keywordize-keys true)]
    (reset! children-state (or (:children state) []))
    (reset! status-state state)))

(defn watch-plan-children! [block-uid children-state status-state]
  "Uses the production renderer plan session so a replaced watch bridge rebinds
   without remounting, and unavailable pulls keep last-good children."
  (try
    (if-let [create (some-> js/window .-nautilusLogExtensionData .-createRendererPlanSession)]
      (let [session (.call create nil (clj->js {:planUid block-uid}))
            apply! (fn [state]
                     (apply-plan-session-state! children-state status-state state))]
        (when (.-subscribe session)
          (.subscribe session apply!))
        (when (.-sync session)
          (.sync session))
        session)
      nil)
    (catch :default _e nil)))

(defn sync-plan-session! [plan-session alive? block-uid children-state status-state]
  "Creates the production session once the factory exists after mount.
   Cleanup must not recreate a destroyed session."
  (when @alive?
    (when-not @plan-session
      (when-let [session (watch-plan-children! block-uid children-state status-state)]
        (reset! plan-session session)))
    (when-let [session @plan-session]
      (try
        (.sync session)
        (catch :default _e nil)))))

(defn reset-now-time-atom [now-time-atom & [epoch-state]]
  (let [now (new js/Date (.now js/Date))
        minutes (+ (* (.getHours now) 60) (.getMinutes now))]
    (reset! now-time-atom minutes)
    ;; Minute-of-day alone cannot wake a chart resumed at the same time tomorrow.
    (when epoch-state (reset! epoch-state (js/Math.floor (/ (.getTime now) 60000))))))

(defn switch-done-visibility-button [show-done-state copy]
  (let [label (if @show-done-state (:hideDone copy) (:showDone copy))]
    [:button
     {:type "button"
      :on-click #(swap! show-done-state not)
      :class "nautilus-log-toggle-btn"
      :data-nautilus-tooltip label
      :aria-pressed @show-done-state
      :aria-description (:doneScope copy)
      :aria-label label}
     (if @show-done-state
       [:svg {:width "18" :height "18" :viewBox "0 0 24 24" :fill "none" :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"}
        [:path {:d "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"}]
        [:circle {:cx "12" :cy "12" :r "3"}]]
       [:svg {:width "18" :height "18" :viewBox "0 0 24 24" :fill "none" :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"}
        [:path {:d "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"}]
        [:line {:x1 "1" :y1 "1" :x2 "23" :y2 "23"}]])]))

(defn plan-writes-allowed? [plan-status-state]
  (let [status @plan-status-state]
    (boolean (and (:writesAllowed status)
                  (= (:status status) "ready")))))

(defn desk-button [block-uid page-title-val copy]
  (let [options (fn [node]
                  (clj->js {:planUid block-uid :pageTitle page-title-val :origin node
                            :container (some-> node (.closest ".nautilus-log-container")
                                               (.querySelector ":scope > .nautilus-log-desk-host"))}))]
    [:button
     {:type "button" :role "switch"
      :class "nautilus-log-toggle-btn nautilus-log-desk-btn"
      :aria-label (:desk copy) :aria-checked "false" :data-nautilus-tooltip (:desk copy)
      ;; The existing Desk owner restores the real session state, including
      ;; when folding or a renderer update mounts a replacement control.
      :ref (fn [node]
             (when node
               (when-let [register-host (some-> js/window .-nautilusLogExtensionData .-registerDeskHost)]
                 (.call register-host nil (options node)))))
      :on-click (fn [event]
                  (when-let [open-desk (some-> js/window .-nautilusLogExtensionData .-openDesk)]
                    (.call open-desk nil (options (.-currentTarget event)))))}
     [:span {:class "nautilus-log-desk-switch-track" :aria-hidden "true"}
      [:span {:class "nautilus-log-desk-switch-thumb"}]]]))

(defn tidy-button [block-uid settled-uids tidy-state settings copy plan-status-state]
  [:button
   {:on-click (fn []
                (when (and (plan-writes-allowed? plan-status-state) (not @tidy-state))
                  (when-let [tidy (some-> js/window .-nautilusLogExtensionData .-tidyPlan)]
                    (reset! tidy-state true)
                    (-> (js/Promise.resolve
                         (.call tidy nil
                                (clj->js {:planUid block-uid
                                          :settledUids settled-uids
                                          :language (:language settings)})))
                        (.catch (fn [error]
                                  (.error js/console "[Nautilus Log] Tidy failed" error)))
                        (.finally (fn [] (reset! tidy-state false)))))))
    :class "nautilus-log-toggle-btn nautilus-log-tidy-btn"
    :data-nautilus-tooltip (:tidy copy)
    :aria-label (:tidy copy)
    :aria-busy (if @tidy-state "true" "false")
    :disabled (or @tidy-state (not (plan-writes-allowed? plan-status-state)))}
   ;; Keep one 18px control canvas while optically reducing this dense glyph to
   ;; 16.5px. The supplied Lucide paths remain unchanged and centered.
   [:svg {:width "18" :height "18" :viewBox "0 0 24 24" :fill "none"
          :stroke "currentColor" :stroke-width "2" :stroke-linecap "round"
          :stroke-linejoin "round" :aria-hidden "true"}
    [:g {:transform "translate(1 1) scale(0.9166667)"}
     [:path {:d "m16 22-1-4"}]
     [:path {:d "M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"}]
     [:path {:d "M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"}]
     [:path {:d "m8 22 1-4"}]]]])

(defn calendar-result-popover [result settings copy]
  (let [model (or (log-core-call "calendarSyncResultModel"
                                 {:result result :language (:language settings)})
                  {:header (str (:calendarSynced copy) " · " (:calendarJustNow copy))
                   :changes (:calendarNoChanges copy)
                   :inventory (:calendarNoItems copy)
                   :notes []})]
    [:div {:class "nautilus-log-calendar-popover"
           :role "status"
           :aria-live "polite"}
     [:div {:class "nautilus-log-calendar-popover__header"}
      [:span {:class "nautilus-log-calendar-popover__status" :aria-hidden "true"} "✓"]
      [:span (:header model)]]
     [:div {:class "nautilus-log-calendar-popover__line"} (:changes model)]
     (when (seq (:local model))
       [:div {:class "nautilus-log-calendar-popover__line"} (:local model)])
     [:div {:class "nautilus-log-calendar-popover__line nautilus-log-calendar-popover__line--muted"}
      (:inventory model)]
     (for [[index note] (map-indexed vector (:notes model))]
       ^{:key (str "calendar-note-" index)}
       [:div {:class "nautilus-log-calendar-popover__line nautilus-log-calendar-popover__line--muted"}
        note])
     (when (seq (:restore model))
       [:div {:class "nautilus-log-calendar-popover__line nautilus-log-calendar-popover__line--hint"}
        (:restore model)])]))

(defn calendar-error-popover [message copy]
  [:div {:class "nautilus-log-calendar-popover nautilus-log-calendar-popover--error"
         :role "alert"}
   [:div {:class "nautilus-log-calendar-popover__header"}
    [:span {:class "nautilus-log-calendar-popover__status" :aria-hidden "true"} "!"]
    [:span (:calendarSyncFailed copy)]]
   [:div {:class "nautilus-log-calendar-popover__line"} message]
   [:div {:class "nautilus-log-calendar-popover__line nautilus-log-calendar-popover__line--hint"}
    (:calendarTryAgain copy)]])

(defn calendar-button [block-uid page-title-val calendar-state settings copy plan-status-state]
  (when (and (:google-calendar-enabled settings)
             (:google-calendar-configured settings))
    (let [busy? (:busy @calendar-state)
          popover-open? (:open @calendar-state)
          result (:result @calendar-state)
          error (:error @calendar-state)
          writes-allowed? (plan-writes-allowed? plan-status-state)
          default-tooltip (str (:calendar copy) "\n" (:calendarForce copy))
          tooltip (when-not popover-open?
                    (if busy? (:calendarSyncing copy) default-tooltip))]
      [:span
       {:class "nautilus-log-calendar-control"
        :on-mouse-enter #(swap! calendar-state assoc :hovered true)
        :on-mouse-leave #(swap! calendar-state assoc :hovered false :open false)}
       [:button
        {:on-click (fn [event]
                     (when (and writes-allowed? (not busy?))
                       (when-let [sync-calendar (some-> js/window .-nautilusLogExtensionData .-syncCalendarPlan)]
                         (swap! calendar-state assoc
                                :busy true :result nil :error nil :open false)
                         (-> (js/Promise.resolve
                              (.call sync-calendar nil
                                     (clj->js {:planUid block-uid
                                               :pageTitle page-title-val
                                               :force (.-altKey event)})))
                             (.then (fn [sync-result]
                                      (swap! calendar-state assoc
                                             :busy false
                                             :result (js->clj sync-result :keywordize-keys true)
                                             :error nil
                                             :open (boolean (:hovered @calendar-state)))))
                             (.catch (fn [sync-error]
                                       (.error js/console "[Nautilus Log] Google Calendar sync failed" sync-error)
                                       (swap! calendar-state assoc
                                              :busy false
                                              :result nil
                                              :error (or (.-message sync-error) (str sync-error))
                                              :open (boolean (:hovered @calendar-state)))))))))
         :on-key-down (fn [event]
                        (when (= "Escape" (.-key event))
                          (swap! calendar-state assoc :open false)))
         :class "nautilus-log-toggle-btn nautilus-log-calendar-btn"
         :data-nautilus-tooltip tooltip
         :aria-label (if busy? (:calendarSyncing copy) default-tooltip)
         :aria-busy (if busy? "true" "false")
         :aria-expanded (if popover-open? "true" "false")
         :disabled (or busy? (not writes-allowed?))}
        [:span {:class (str "bp3-icon "
                            (if busy?
                              "bp3-icon-refresh nautilus-log-calendar-spinner"
                              "bp3-icon-calendar"))
                :aria-hidden "true"}]]
       (when (and popover-open? result)
         [calendar-result-popover result settings copy])
       (when (and popover-open? error)
         [calendar-error-popover error copy])])))

(defn collapse-context-key [render-context]
  (if (= render-context :sidebar) "sidebar" "main"))

(defn collapse-storage-key [block-uid render-context]
  (str "nautilus-log:collapsed:v2:" block-uid ":" (collapse-context-key render-context)))

(defn read-collapsed-state [block-uid render-context]
  (try
    (= "true" (.getItem js/localStorage (collapse-storage-key block-uid render-context)))
    (catch :default _e false)))

(defn write-collapsed-state [block-uid render-context value]
  (try
    (.setItem js/localStorage (collapse-storage-key block-uid render-context) (str value))
    (catch :default _e nil)))

(defn collapse-button [collapsed-state block-uid render-context copy]
  [:button
   {:on-click #(let [next (not @collapsed-state)]
                 (reset! collapsed-state next)
                 (write-collapsed-state block-uid render-context next))
    :class "nautilus-log-toggle-btn nautilus-log-collapse-btn"
    :data-nautilus-tooltip (if @collapsed-state (:expand copy) (:collapse copy))
    :aria-label (if @collapsed-state (:expand copy) (:collapse copy))}
   [:svg {:width "18" :height "18" :viewBox "0 0 24 24" :fill "none"
          :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"
          :aria-hidden "true"}
    [:rect {:x "3" :y "4" :width "18" :height "16" :rx "2.5"}]
    [:path {:d "M3 9h18"}]
    [:path {:d (if @collapsed-state "m9 13 3 3 3-3" "m9 16 3-3 3 3")}]]])

(defn switch-debug-button [] ;; debug button
  [:button {:on-click #(swap! debug-state-atom not)    
            :style {:background-color "#5B5B5BBF", :color "rgb(254,254,254)"           
                    :margin "8px" :border-radius "8px" :display "inline-block"}}       
   (if @debug-state-atom                               
     (str "debug is on")                               
     (str "🪲 debug is off"))])                        

(defn arg-tag->str [arg]
  (if (vector? arg)
    (let [uid (second arg)
          decoded (get-page-title uid)]
      (str "#" decoded))
    arg))

(defn safe-int [value]
  (try
    (cond
      (number? value) (int value)
      (and (string? value) (re-matches #"\d+" (str/trim value)))
      (js/parseInt value 10)
      :else nil)
    (catch :default _e nil)))

(def settings-event-name "nautilus-log:settings-changed")

(defn render-arg-values [args]
  (let [values (vec args)]
    (if (and (= 1 (count values)) (sequential? (first values)))
      (vec (first values))
      values)))

(defn args->settings [args]
  (let [[a1 a2 a3 a4 a5] (render-arg-values args)
        a4 (when-not (nil? a4) (arg-tag->str a4))
        a1 (safe-int a1)
        a2 (safe-int a2)
        a3 (safe-int a3)
        a5 (safe-int a5)
        normalized (or (log-core-call "normalizeScheduleSettings"
                                       {:startHour (or a3 (/ init-workday-start 60))
                                        :endHour (or a5 (/ init-workday-end 60))})
                       {:startHour 5 :endHour 21 :startMinutes 300 :endMinutes 1260})]
    {:legend-len-limit (if (and a1 (between a1 15 30)) a1 init-len-limit)
     :default-duration (if (and a2 (between a2 5 60)) a2 init-duration)
     :workday-start (:startMinutes normalized)
     :workday-end (:endMinutes normalized)
     :workday-start-hour (:startHour normalized)
     :workday-end-hour (:endHour normalized)
     :custom-color-1-tag (if (nil? a4)
                           init-custom-color-1-tag
                           (if (string? a4)
                             (str a4)
                             (arg-tag->str a4)))}))

(defn extension-runtime-settings []
  (try
    (if-let [settings (some-> js/window .-nautilusLogExtensionData .-settings)]
      (js->clj settings :keywordize-keys true)
      {})
    (catch :default _e {})))

(defn resolve-render-settings [args]
  (let [values (render-arg-values args)
        values (if (> (count values) 3)
                 (assoc values 3 (arg-tag->str (nth values 3)))
                 values)]
    (or (log-core-call "resolveRendererSettings"
                        {:runtime (extension-runtime-settings)
                         :args values})
        (args->settings values))))

(defn ui-copy [settings]
  (or (log-core-call "uiCopy" (:language settings))
      {:capacity {:available "Available" :events "Events" :demand "Demand" :overload "Overload" :fragmented "No fitting slot" :remaining "Remaining"
                  :burningAvailable "Flexible time is elapsing" :burningEvents "Event time is elapsing" :now "Current time"}
       :allocation {:planned "planned" :free "free" :over "over" :noSlot "no slot" :left "left"}
       :legend {:urgent "Urgent" :event "Event" :task "Task"}
       :controls {:hideDone "Hide completed on chart" :showDone "Show completed on chart"
                  :doneScope "Chart only. Desk shows unfinished tasks."
                  :desk "Open Desk"
                  :calendar "Sync Google Calendar" :calendarForce "⌥ Click to restore Google-managed items"
                  :calendarSetup "Connect Google Calendar and sync this date"
                  :calendarSyncing "Syncing Google Calendar…" :calendarSynced "Synced"
                  :calendarJustNow "Just now" :calendarNoChanges "No changes from Google"
                  :calendarCreated "added" :calendarUpdated "updated" :calendarRemoved "removed"
                  :calendarLocalDeletion "local deletion preserved" :calendarLocalDeletions "local deletions preserved"
                  :calendarLocalChange "local change preserved" :calendarLocalChanges "local changes preserved"
                  :calendarEvent "event" :calendarEvents "events" :calendarTask "task" :calendarTasks "tasks"
                  :calendarFound "found" :calendarNoItems "No events or tasks found"
                  :calendarRestore "⌥ Click Calendar to restore" :calendarRestoreFields "⌥ Click Calendar to restore Google fields"
                  :calendarItem "item" :calendarItems "items"
                  :calendarSyncFailed "Sync failed" :calendarTryAgain "Click Calendar to try again"
                  :calendarAllDaySkipped "all-day skipped" :calendarTasksPending "reconnect for Tasks"
                  :calendarTasksUnavailable "Tasks unavailable"
                  :collapse "Collapse Nautilus Log" :expand "Expand Nautilus Log"}
       :panels {:overview "Overview" :overflow "Unscheduled today" :warnings "Schedule warnings" :schedule "Schedule" :item "item" :items "items"
                :untimedCompleted "Completed · No time recorded"}
       :tooltips {:task "Task" :event "Event" :available "Available slot" :availableNow "Available now"
                  :pastGap "Past gap" :pastGapSummary "Uncovered"
                  :pastGapExplanation "No task or event in the chart covers this interval; actual activity is unknown."
                  :completed "Completed" :noCompletionTime "No completion time recorded"
                  :inheritedCompletion "Completion status from reference" :locateTask "Click to locate · ⇧ Sidebar"}
       :warnings {:overnight "Continues into the next day"
                  :sameTime "Start and end times cannot be the same"}}))

(defn capacity-metrics [capacity settings]
  (or (log-core-call "capacityMetrics" {:capacity capacity :language (:language settings)})
      {:planned {:key "demand" :label "Demand" :value "0m" :summaryLabel "planned" :percent "0%" :percentLabel "left" :percentTone "neutral" :tone "neutral"}
       :status {:key "remaining" :label "Remaining" :value "0m" :summaryLabel "free" :tone "neutral"}
       :available {:key "available" :label "Available" :value "0m" :tone "neutral"}
       :events {:key "events" :label "Events" :value "0m" :tone "event"}}))

(defn burning-flame-icon [label]
  [:svg {:class "nautilus-log-burning-icon"
         :width "16"
         :height "16"
         :viewBox "0 0 24 24"
         :fill "none"
         :stroke "currentColor"
         :stroke-width "1.8"
         :stroke-linecap "round"
         :stroke-linejoin "round"
         :role "img"
         :aria-label label}
   [:title label]
   [:path {:d "M12 22c4.4 0 8-3.1 8-7.5 0-3.3-1.8-5.8-4.4-8.2.2 2.7-1.5 4.2-2.8 4.9.4-4.1-1.3-7.1-4.6-9.2.3 3.8-1 6-2.6 8.2A7.4 7.4 0 0 0 4 14.5C4 18.9 7.6 22 12 22Z"}]])

(defn metric-reading-component [metric]
  (let [reading-label (str (:value metric)
                           (when-let [total (:total metric)] (str " / " total))
                           (when (:burning metric)
                             (str ". " (:burningLabel metric))))]
    [:div {:class (str "nautilus-log-metric nautilus-log-metric--" (:tone metric))}
     [:span {:class "nautilus-log-metric-label"} (:label metric)]
     [:span {:class "nautilus-log-metric-reading"
             :aria-label (when (or (:total metric) (:burning metric)) reading-label)}
      [:strong {:class "nautilus-log-metric-value"} (:value metric)]
      (when-let [total (:total metric)]
        [:span {:class "nautilus-log-metric-total"} (str "/ " total)])
      (when (:burning metric)
        [burning-flame-icon (:burningLabel metric)])]]))

(defn metric-summary-component [metric]
  [:span {:class (str "nautilus-log-metric-summary-item nautilus-log-metric--" (:tone metric))}
   [:strong {:class "nautilus-log-metric-value"} (:value metric)]
   [:span {:class "nautilus-log-metric-summary-label"} (:summaryLabel metric)]])

(defn metrics-capacity-component [available events]
  [:div {:class "nautilus-log-metrics-capacity"}
   [metric-reading-component available]
   [metric-reading-component events]])

(defn metrics-component [metrics]
  (let [{:keys [planned status available events]} metrics
        ordered-metrics [status planned available events]
        aria-parts (cons (str (:percent planned) " " (:percentLabel planned))
                         (map #(str (:label %) " " (:value %)
                                    (when-let [total (:total %)] (str " / " total))
                                    (when (:burning %)
                                      (str ", " (:burningLabel %)))) ordered-metrics))
        aria-label (str/join ", " aria-parts)]
    [:div {:class "nautilus-log-metrics" :aria-label aria-label}
     [:div {:class "nautilus-log-metrics-summary"}
      [:span {:class (str "nautilus-log-metric-summary-item nautilus-log-metric-percent nautilus-log-metric-percent--" (:percentTone planned))}
       [:strong {:class "nautilus-log-metric-value"} (:percent planned)]
       [:span {:class "nautilus-log-metric-summary-label"} (:percentLabel planned)]]
      [:span {:class "nautilus-log-metric-separator" :aria-hidden "true"} "·"]
      [metric-summary-component status]
      [:span {:class "nautilus-log-metric-separator" :aria-hidden "true"} "·"]
      [metric-summary-component planned]]
     [metrics-capacity-component available events]]))

(defn capacity-metrics-component [capacity settings]
  [metrics-component (capacity-metrics capacity settings)])

(defn html-legend-component [copy]
  [:div {:class "nautilus-log-html-legend" :aria-label "Nautilus Log legend"}
   [:span {:class "nautilus-log-legend-item"}
    [:i {:class "nautilus-log-legend-dot nautilus-log-legend-dot--urgent" :aria-hidden "true"}]
    (get-in copy [:legend :urgent])]
   [:span {:class "nautilus-log-legend-item"}
    [:i {:class "nautilus-log-legend-dot nautilus-log-legend-dot--event" :aria-hidden "true"}]
    (get-in copy [:legend :event])]
   [:span {:class "nautilus-log-legend-item"}
    [:i {:class "nautilus-log-legend-dot nautilus-log-legend-dot--task" :aria-hidden "true"}]
    (get-in copy [:legend :task])]])

(defn compact-overview-component [capacity settings copy compact-open-state]
  (let [metrics (capacity-metrics capacity settings)
        planned (:planned metrics)
        status (:status metrics)
        warning? (= "warning" (:tone status))
        summary-aria (str (get-in copy [:panels :overview])
                          ". " (:value planned) " " (:summaryLabel planned)
                          ". " (:value status) " " (:summaryLabel status)
                          ". " (:percent planned) " " (:percentLabel planned))]
    [:details {:class (str "nautilus-log-compact-overview"
                           (when warning? " nautilus-log-compact-overview--warning"))
               :open @compact-open-state
               :on-toggle #(let [next-open? (.-open (.-currentTarget %))]
                             (when (not= next-open? @compact-open-state)
                               (reset! compact-open-state next-open?)))}
     [:summary {:class "nautilus-log-compact-summary nautilus-log-compact-overview-summary"
                :aria-label summary-aria}
      [:span {:class "nautilus-log-compact-overview-summary-content"}
      [:span {:class "nautilus-log-compact-overview-label"}
        (get-in copy [:panels :overview])]
       [:span {:class "nautilus-log-metric-separator" :aria-hidden "true"} "·"]
       [:span {:class (str "nautilus-log-metric-summary-item nautilus-log-metric-percent nautilus-log-metric-percent--" (:percentTone planned))}
        [:strong {:class "nautilus-log-metric-value"} (:percent planned)]
        [:span {:class "nautilus-log-metric-summary-label"} (:percentLabel planned)]]
       [:span {:class "nautilus-log-metric-separator" :aria-hidden "true"} "·"]
       [metric-summary-component status]
       [:span {:class "nautilus-log-metric-separator" :aria-hidden "true"} "·"]
       [metric-summary-component planned]]
      [:span {:class "nautilus-log-overview-chevron" :aria-hidden "true"}]]
     [:div {:class "nautilus-log-compact-overview-body"}
      [metrics-capacity-component (:available metrics) (:events metrics)]
      [html-legend-component copy]]]))

(defn localized-warning [warning copy]
  (case warning
    "连续到次日" (get-in copy [:warnings :overnight])
    "开始时间与结束时间不能相同" (get-in copy [:warnings :sameTime])
    warning))

(defn schedule-warning-panel [events copy]
  (let [warnings (vec (filter :warning events))]
    (when (seq warnings)
      [:details {:class "nautilus-log-warning-panel"}
       [:summary (str (get-in copy [:panels :warnings]) " · " (count warnings) " "
                      (if (= 1 (count warnings)) (get-in copy [:panels :item]) (get-in copy [:panels :items])))]
       [:ul
        (for [event warnings]
          ^{:key (:uid event)}
          [:li
           [:span (:description event)]
           [:span {:class "nautilus-log-warning-message"} (localized-warning (:warning event) copy)]])]])))

(defn log-controls [show-done-state settings collapsed-state block-uid page-title-val render-context settled-uids tidy-state calendar-state copy show-debug-button? plan-status-state]
  [:div {:class "nautilus-log-controls-top"}
   [desk-button block-uid page-title-val (:controls copy)]
   [switch-done-visibility-button show-done-state (:controls copy)]
   [tidy-button block-uid settled-uids tidy-state settings (:controls copy) plan-status-state]
   [calendar-button block-uid page-title-val calendar-state settings (:controls copy) plan-status-state]
   [collapse-button collapsed-state block-uid render-context (:controls copy)]
   (when show-debug-button? [switch-debug-button])])

(defn render-context-probe [render-context-state compact-list-open-state collapsed-state block-uid]
  [:span
   {:class "nautilus-log-context-probe"
    :aria-hidden "true"
    :ref (fn [node]
           (when node
             (let [suppress? (try
                               (if-let [detector (.-shouldSuppressRenderContext js/window.nautilusLogExtensionData)]
                                 (boolean (detector node))
                                 false)
                               (catch :default _e false))
                   sidebar? (try
                              (if-let [detector (.-isRightSidebarRenderContext js/window.nautilusLogExtensionData)]
                                (boolean (detector node))
                                false)
                              (catch :default _e false))
                   next-state (cond
                                suppress? :suppressed
                                sidebar? :sidebar
                                :else :visible)]
               (when (nil? @compact-list-open-state)
                 (reset! compact-list-open-state (not sidebar?)))
               (when (not= @render-context-state next-state)
                 (when (not= next-state :suppressed)
                   (reset! collapsed-state (read-collapsed-state block-uid next-state)))
                 (reset! render-context-state next-state)))))}])

(defn compact-chart-width? [width]
  (boolean (log-core-call "isCompactChartWidth" width)))

(defn observe-compact-width! [node compact-state presentation-width-state hover-info-state resize-observer-state]
  (when-let [current-observer @resize-observer-state]
    (.disconnect current-observer)
    (reset! resize-observer-state nil))
  (if-not node
    (clear-detail-state! hover-info-state)
    (let [update-width! (fn [width]
                          (let [next-width (max 0 (js/Math.round width))
                                next-compact? (compact-chart-width? next-width)]
                            ;; A local shell resize changes the presentation contract even
                            ;; when it stays in the same variant; stale details must not linger.
                            (when (not= @presentation-width-state next-width)
                              (clear-detail-state! hover-info-state)
                              (reset! presentation-width-state next-width))
                            (when (not= @compact-state next-compact?)
                              (reset! compact-state next-compact?))))]
      (update-width! (.-width (.getBoundingClientRect node)))
      (when (.-ResizeObserver js/window)
        (let [observer (js/ResizeObserver.
                        (fn [entries]
                          (when-let [entry (aget entries 0)]
                            (update-width! (.-width (.-contentRect entry))))))]
          (.observe observer node)
          (reset! resize-observer-state observer))))))

(defn main [{:keys [:block-uid]} & args]
  (r/with-let [plan-session (atom nil)
               plan-status-state (r/atom {:status "unbound" :writesAllowed false})
               plan-session-alive? (atom true)
               watched-children-state (r/atom [])
               is-running? #(try
                              (boolean (.-running js/window.nautilusLogExtensionData))
                              (catch :default _e false))
               *running? (r/atom (or (is-running?) nil))
               check-interval (js/setInterval
                               (fn []
                                 (let [next-running-state (is-running?)]
                                   (when (not= @*running? next-running-state)
                                     (reset! *running? next-running-state)))
                                 (sync-plan-session! plan-session plan-session-alive? block-uid watched-children-state plan-status-state))
                               5000)
               settings-state (r/atom (resolve-render-settings args))
               settings-listener (fn [_event]
                                   (reset! settings-state (resolve-render-settings args))
                                   (sync-plan-session! plan-session plan-session-alive? block-uid watched-children-state plan-status-state))
               _settings-listener (.addEventListener js/window settings-event-name settings-listener)
               now-time-atom (r/atom (now-minutes))
               clock-epoch-state (r/atom (js/Math.floor (/ (.now js/Date) 60000)))
               clock-version-state (r/atom 0)
               collapsed-state (r/atom false)
               render-context-state (r/atom :pending)
               compact-list-open-state (r/atom nil)
               compact-overview-open-state (r/atom false)
               hover-info-state (r/atom {:pointer nil :focus nil :expanded nil})
               unload-listener (fn [_event] (clear-detail-state! hover-info-state))
               _unload-listener (.addEventListener js/window "unload" unload-listener)
               compact-state (r/atom false)
               presentation-width-state (r/atom 0)
               resize-observer-state (atom nil)
               container-ref (fn [node]
                               (observe-compact-width! node compact-state presentation-width-state hover-info-state resize-observer-state))
               page-title-val (page-title block-uid)
               desk-host-node (atom nil)
               desk-host-ref (fn [node]
                               (when-let [previous @desk-host-node]
                                 (when-not (identical? previous node)
                                   (when-let [close-host (some-> js/window .-nautilusLogExtensionData .-closeDeskHost)]
                                     (.call close-host nil previous))))
                               (reset! desk-host-node node)
                               (when node
                                 (when-let [register-host (some-> js/window .-nautilusLogExtensionData .-registerDeskHost)]
                                   (.call register-host nil
                                          (clj->js {:planUid block-uid
                                                    :pageTitle page-title-val
                                                    :container node
                                                    :origin (some-> node
                                                                    (.closest ".nautilus-log-container")
                                                                    (.querySelector ".nautilus-log-desk-btn"))})))))
               daily-page-atom? (r/atom (daily-page? block-uid))
               refresh-clock! (fn []
                                (when @plan-session-alive?
                                  (reset-now-time-atom now-time-atom clock-epoch-state)
                                  (let [next-day? (daily-page? block-uid)]
                                    (when (not= @daily-page-atom? next-day?)
                                      (reset! daily-page-atom? next-day?)))))
               clock-listener (fn [_event]
                                (when @plan-session-alive?
                                  (refresh-clock!)
                                  (swap! clock-version-state inc)))
               focus-listener (fn [_event] (refresh-clock!))
               visibility-listener (fn [_event]
                                     (when (= "visible" (.-visibilityState js/document)) (refresh-clock!)))
               _clock-listener (.addEventListener js/window "nautilus-log:clock-changed" clock-listener)
               _focus-listener (.addEventListener js/window "focus" focus-listener)
               _pageshow-listener (.addEventListener js/window "pageshow" focus-listener)
               _visibility-listener (.addEventListener js/document "visibilitychange" visibility-listener)
               clock-interval (js/setInterval refresh-clock! 60000)
               _plan-session (sync-plan-session! plan-session plan-session-alive? block-uid watched-children-state plan-status-state)
               *text-events (r/track
                             (fn []
                               (let [settings @settings-state
                                     clock-version @clock-version-state
                                     clock-minute @now-time-atom
                                     children-list (->> @watched-children-state
                                                        (filter #(not= "" (:block/string %)))
                                                        (sort-by :block/order))
                                     mapped (->> children-list
                                                 (mapv #(task-instance-row % settings))
                                                 (filterv #(not= "structure" (:kind %))))
                                     completed-task-uids (->> mapped
                                                              (filter #(and (= "task" (:kind %))
                                                                            (= "DONE" (get-in % [:task-instance :status]))))
                                                              (mapv :uid))
                                     clock-context (if (seq completed-task-uids)
                                                     (clock-render-context page-title-val completed-task-uids (:workday-end settings))
                                                     {:entries []})
                                     parsed (mapv #(parse-row-params % settings clock-context) mapped)
                                     filtered (filterv #(not= "" (:description %)) parsed)]
                                 (let [history (log-core-call "partitionChartEvents" filtered)]
                                   ;; Keep unanchored completion for the estimate projection,
                                   ;; separate from live pending scheduling and source timestamps.
                                   ;; Tidy still receives every locally settled wrapper UID.
                                   [(add-start-after (:pendingEvents history))
                                    (:timedDoneEvents history) (:untimedDoneEvents history)
                                    (:completedUids history) filtered]))))
               show-done-state (r/atom true)
               tidy-state (r/atom false)
               calendar-state (r/atom {:busy false
                                       :hovered false
                                       :open false
                                       :result nil
                                       :error nil})]
    (case @*running?
      nil [:div {:class "nautilus-log-loading"} [:strong "Loading Nautilus Log..."]]
      false [:div {:class "nautilus-log-not-installed"}
             [:strong {:style {:color "red"}} "Extension not installed. To use Nautilus Log, install it from Roam Depot."]]
      (cond
        (= :pending @render-context-state)
        [render-context-probe render-context-state compact-list-open-state collapsed-state block-uid]

        (= :suppressed @render-context-state)
        [:span {:class "nautilus-log-context-probe" :aria-hidden "true"}]

        :else
        (do
          (reset-now-time-atom now-time-atom clock-epoch-state)
          (let [settings @settings-state
                copy (ui-copy settings)
                show-debug-button? (= :debug (first args))
                timeline-state (or (log-core-call "timelineDayState"
                                                   {:displayDate page-title-val
                                                    :currentDate (* 60000 @clock-epoch-state)
                                                    :startMinutes (:workday-start settings)
                                                    :endMinutes (:workday-end settings)
                                                    :nowMinutes @now-time-atom})
                                   {:relation (if @daily-page-atom? "today" "other")
                                    :timelineMinutes @now-time-atom
                                    :scheduleFromMinutes (if @daily-page-atom? @now-time-atom (:workday-start settings))
                                    :capacityFromMinutes (if @daily-page-atom? @now-time-atom (:workday-start settings))
                                    :elapsedThroughMinutes @now-time-atom
                                    :interactive @daily-page-atom?
                                    :showElapsed @daily-page-atom?
                                    :showAvailableSlots true
                                    :showNow @daily-page-atom?})
                plan-from-time (:scheduleFromMinutes timeline-state)
                plan-status @plan-status-state
                [text-events done-events untimed-done-events completed-uids source-events] @*text-events
                planning-events (if (= "past" (:relation timeline-state))
                                  (vec (remove #(and (:todo %) (not (:done %))) text-events))
                                  text-events)
                expired-fixed-uids (->> text-events
                                        (filter :meeting)
                                        (filter (fn [event]
                                                  (or (= "past" (:relation timeline-state))
                                                      (and (= "today" (:relation timeline-state))
                                                           (number? (:end event))
                                                           (<= (:end event) (:elapsedThroughMinutes timeline-state))))))
                                        (mapv :uid))
                settled-uids (vec (distinct (concat completed-uids expired-fixed-uids)))
                pending-tasks (vec (filter #(and (:todo %) (not (:done %))) planning-events))
                fixed-events (vec (filter #(and (:meeting %) (not (:done %))) text-events))
                all-fixed-events (vec (concat fixed-events (filter :meeting done-events)))
                capacity-base (or (log-core-call "calculateCapacity"
                                                    {:startMinutes (:workday-start settings)
                                                     :endMinutes (:workday-end settings)
                                                    :nowMinutes (:capacityFromMinutes timeline-state)
                                                    :fixedEvents fixed-events
                                                    :allFixedEvents all-fixed-events
                                                    :pendingTasks pending-tasks})
                                  {:availableMinutes 0 :totalAvailableMinutes 0
                                   :fixedMinutes 0 :totalFixedMinutes 0
                                   :demandMinutes 0 :overloadMinutes 0 :slackMinutes 0
                                   :unplacedMinutes 0 :overflowTasks []})
                burning-bucket (log-core-call "burningCapacityBucket"
                                               {:startMinutes (:workday-start settings)
                                                :endMinutes (:workday-end settings)
                                                :nowMinutes (:capacityFromMinutes timeline-state)
                                                :fixedEvents fixed-events})
                capacity (assoc capacity-base :burningBucket burning-bucket)
                events-state [(fill-day planning-events (:workday-start settings) (:workday-end settings) plan-from-time) done-events untimed-done-events source-events]]
            [:div {:class (str "nautilus-log-container" (when @collapsed-state " nautilus-log-collapsed"))
                   :data-nautilus-log-block block-uid
                   :data-nautilus-plan-status (or (:status plan-status) "unbound")}
             (if @collapsed-state
               (do (clear-detail-state! hover-info-state)
                   [log-controls show-done-state settings collapsed-state block-uid page-title-val @render-context-state settled-uids tidy-state calendar-state copy show-debug-button? plan-status-state])
               [:div {:class "nautilus-log-shell" :ref container-ref}
                [:header {:class (str "nautilus-log-header"
                                     (when @compact-state " nautilus-log-header--compact"))}
                 [:div {:class "nautilus-log-header-copy"}
                  [capacity-metrics-component capacity settings]]
                 [:div {:class "nautilus-log-header-actions"}
                  [log-controls show-done-state settings collapsed-state block-uid page-title-val @render-context-state settled-uids tidy-state calendar-state copy show-debug-button? plan-status-state]
                  [html-legend-component copy]]]
                (when @compact-state
                  [compact-overview-component capacity settings copy compact-overview-open-state])
                [:div {:class "nautilus-log-content"}
                 [show-events events-state show-done-state now-time-atom page-title-val @presentation-width-state settings copy compact-list-open-state hover-info-state block-uid timeline-state]
                 [:div {:class "nautilus-log-status-rail"}
                  [:div {:class "nautilus-log-status-slot"} [schedule-warning-panel text-events copy]]]]])
             ;; Keep the host mounted while folded so its scoped outline claim
             ;; survives; Desk itself watches the collapsed class and hides/pause.
             [:div {:class "nautilus-log-desk-host"
                    :data-nautilus-desk-plan block-uid
                    :data-nautilus-desk-page page-title-val
                    :ref desk-host-ref}]]))))
    (finally
      (reset! plan-session-alive? false)
      (js/clearInterval check-interval)
      (js/clearInterval clock-interval)
      (.removeEventListener js/window settings-event-name settings-listener)
      (.removeEventListener js/window "nautilus-log:clock-changed" clock-listener)
      (.removeEventListener js/window "focus" focus-listener)
      (.removeEventListener js/window "pageshow" focus-listener)
      (.removeEventListener js/document "visibilitychange" visibility-listener)
      (.removeEventListener js/window "unload" unload-listener)
      (clear-detail-state! hover-info-state)
      (when-let [node @desk-host-node]
        (when-let [close-host (some-> js/window .-nautilusLogExtensionData .-closeDeskHost)]
          (.call close-host nil node)))
      (when-let [session @plan-session]
        (try
          (.destroy session)
          (catch :default _e nil)))
      (when-let [resize-observer @resize-observer-state]
        (.disconnect resize-observer)))))
