(ns nautilus-flow-v1
  (:require [clojure.string :as str]
            [reagent.core :as r]
            [roam.datascript :as rd]
            [roam.block :as block]
            [roam.datascript.reactive :as rdr]))

;; ------- default settings -------

(def init-duration 15) ;; value used when no duration is specified as a render parameter

(def init-len-limit 22) ;; value used when no legend length limit is specified as a render parameter

(def custom-color-1 "rgba(234,15,15,0.72)")

(def init-custom-color-1-tag "")

(def init-workday-start 300)

;; ------- other defaults –––––––

(def init-workday-end 1440)

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

(def font-family "'方正屏显雅宋简体', 'FZPingXianYaSong-R-GBK', 'PingFang SC', 'Microsoft YaHei', sans-serif")

(def font-size (if mobile? 12 14))

(def snail-blueprint-outer-radiuses
  (concat (repeat 5 0) [135 140 145 150] (range 145 65 -5)))

(def snail-inner-radius (* 50 snail-scaler))

(defn outer-radius-at [t]
  (* (nth snail-blueprint-outer-radiuses t) snail-scaler))

(def len-central-legend 16) ;; length of the central legend description (page name or date)

;; ----------------- colors, darling ---------------

(def snail-template-color "var(--nautilus-flow-spiral)")

(def clock-hand-color "#EA0F0F5B")

(def task-legend-color "var(--nautilus-flow-task)")

(def meeting-fill-color "var(--nautilus-flow-event-fill)")

(def todo-color-palette
  ["rgba(4,100,132,0.3)", "rgba(8,153,200,0.3)", "rgba(47,186,232,0.3)", "rgba(58,202,249,0.3)"])

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

(declare flow-core-call)

(defn get-legend-rect
  "Returns a new legend rectangle that does not overlap with any of the rects"
  [rects text slice-radians outer-radius center settings order-key anchor-y]
  (let [w (* (/ font-size rect-width-coef) (min (display-width text) (:legend-len-limit settings)))  
        h (* font-size rect-height-coef)
        max-spiral-radius (apply max (map outer-radius-at (range (count snail-blueprint-outer-radiuses))))
        external-rect (first
                       (flow-core-call "placeExternalLabels"
                                       {:centerX (:center-x center)
                                        :centerY (:center-y center)
                                        :exclusionRadius max-spiral-radius
                                        :gap (if mobile? 14 24)
                                        :trackGap 18
                                        :layout "side-rails"
                                        :maxVerticalOffset (* max-spiral-radius 0.92)
                                        :rowGap 26
                                        :collisionPadding 6
                                        :occupiedRects rects
                                        :labels [{:uid text
                                                  :angle slice-radians
                                                  :anchorY anchor-y
                                                  :sortKey order-key
                                                  :width w
                                                  :height h}]}))
        fallback-rect (when rects
                        (assoc
                         (iterate-rect-place {:w w :h h}
                                             rects
                                             (- slice-radians)
                                             (+ outer-radius (if mobile? 0 init-starting-distance))
                                             text
                                             center)
                         :text text))
        new-text-rect (assoc (or external-rect fallback-rect {}) :text text)]
    (assoc new-text-rect :real-rect-radians (real-rect-radians new-text-rect center))))

;; --------------- Flow core bridge ----------------------

(defn flow-core-call [function-name value]
  "Calls the single tested JavaScript scheduling core and turns its result into
   ordinary keywordized ClojureScript data. The extension entry point installs
   this object before any render block can mount."
  (try
    (let [core (.-nautilusFlowCore js/window)
          function (aget core function-name)]
      (when function
        (js->clj (.call function nil (clj->js value)) :keywordize-keys true)))
    (catch :default _e nil)))

(defn spiral-cell-inner-radius [start-minute settings fallback-inner-radius]
  (let [paired-hour (flow-core-call "spiralCellInnerHour"
                                    {:startMinute start-minute
                                     :endMinutes (:workday-end settings)})]
    (if (number? paired-hour)
      (max fallback-inner-radius (outer-radius-at paired-hour))
      fallback-inner-radius)))

(defn now-minutes []
  (let [now (new js/Date)]
    (+ (* (.getHours now) 60) (.getMinutes now))))



;; --------------- reading / writing Roam database ----------------------

(defn eval-state [*get-children]
  (:block/children @*get-children))

(defn get-children-strings [block-uid]
  (r/with-let [*get-children-atom (rdr/pull
                                   [{:block/children [:block/string :block/order {:block/refs [:block/string :block/uid]}]}]
                                   [:block/uid block-uid])
               *children (r/track eval-state *get-children-atom)]
    (map str-with-resolved-block-refs
         (->> @*children
              (sort-by :block/order)))))

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

(defn get-block-str-naked [block-uid]
  (-> (rd/q '[:find ?s
              :in $ ?uid
              :where
              [?b :block/uid ?uid]
              [?b :block/string ?s]]
            block-uid)
      first
      first))

(defn minutes->time [minutes]
  (let [h (int (/ minutes 60))
        m (mod minutes 60)]
    (str (if (< h 10) (str "0" h) h) ":" (if (< m 10) (str "0" m) m))))

(defn rm-prog-from-block-if-done [uid]
  (let [current (get-block-str-naked uid)
        stripped (str/replace current #"\sd\d{1,3}\%" "")]
    ;; Avoid an identical write. This function runs inside a reactive child
    ;; watcher, so a no-op write retriggers the watcher and creates an endless
    ;; stream of Roam transactions for ordinary DONE blocks.
    (when (not= current stripped)
      (block/update {:block
                     {:uid uid
                      :string stripped}}))))

(defn update-block-progress [block-uid increment now-time-atom]
   (let [s (get-block-str-naked block-uid)
         progress-format #"(\sd)(\d{1,3})(\%)" ; #"(\s\%)(\d{1,3})"
         updated-str (if-let [progress-match (re-find progress-format s)]
                       (let [old-progress-str (first progress-match)
                             prog-incremented (+ (int (last (butlast progress-match))) increment)
                             prog-new-str (cond
                                            (= prog-incremented 100) "done"
                                            (> prog-incremented 100) ""
                                            :else (str " d" prog-incremented "%"))]
                         (if (not= prog-new-str "done")
                           (str/replace s old-progress-str prog-new-str)
                           (str (->
                                 (str/replace s old-progress-str "")
                                 (str/replace #"\{\{\[\[TODO\]\]\}\}" "{{[[DONE]]}}"))
                                 " d" (minutes->time @now-time-atom))))
                       (-> (str s " d" increment "%")
                           (str/replace #"\{\{\[\[DONE\]\]\}\}" "{{[[TODO]]}}")
                           (str/replace #"\b(d\d{1,2}(:\d{1,2})?)\b(?!%)" "")))]
     (block/update {:block
                    {:uid block-uid
                     :string updated-str}})))


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

(defn parse-time-range [s]
  (let [range-format #"(?:\d{1,2}(?::\d{1,2})?(?:\s*(?:\s?AM|\s?PM|\s?am|\s?pm))?)\s*(?:-|–|až|to)\s*(?:\d{1,2}(?::\d{1,2})?(?:\s*(?:\s?AM|\s?PM|\s?am|\s?pm))?)"
        range-str (re-find range-format s)]
    (if range-str
      (let [cleaned-str (-> (str/replace s range-str "")
                            (str/replace #"\s\s" " "))
            [_ from-str to-str] (re-find #"(.*)(?:-|–|až|to)(.*)" range-str)
            [to-min h12] (from-1224->min to-str nil)
            [from-min _] (from-1224->min from-str h12)]
        {:range (cond
                  (> to-min from-min) [from-min to-min]
                  (= to-min 0) [from-min 1440]
                  (< to-min from-min) [from-min 1440]
                  :else [from-min from-min])
         :warning (cond
                    (and (< to-min from-min) (not= to-min 0)) "跨日事件仅显示至 24:00"
                    (= to-min from-min) "开始时间与结束时间不能相同"
                    :else nil)
         :cleaned-str cleaned-str})
      {:range nil :warning nil :cleaned-str s})))

(defn parse-duration [s settings]
  (let [duration-format #"(\d{1,3})(min|m)"]
    (if-let [duration-match (re-find duration-format s)]
      (let [duration-str (first duration-match)
            cleaned-str (str/replace s duration-str "")]
        {:duration (int (second duration-match))
         :cleaned-str cleaned-str})
      {:duration (:default-duration settings) :cleaned-str s})))

(defn parse-progress [s]
  (let [progress-format #"(\sd)(\d{1,3})(\%)"]
    (if-let [progress-match (re-find progress-format s)]
      (let [progress-str (first progress-match)
            cleaned-str (str/replace s progress-str "")
            prog-int (int (last (butlast progress-match)))]
        {:progress (if (> prog-int 100) 100 prog-int)
         :cleaned-str cleaned-str})
      {:progress 0 :cleaned-str s})))

(defn parse-done-time [s]
  (let [done-time-format #"d(\d{1,2}(?::\d{1,2})?)"
        done-time-match (re-find done-time-format s)]
    (if done-time-match
      (let [[_ done-time-str] done-time-match
            [h m] (str/split done-time-str #":")
            cleaned-str (str/replace s (str "d" done-time-str) "")]
        {:done-at (+ (if m (int m) 0) (* 60 (int h)))
         :cleaned-str cleaned-str})
      {:done-at nil :cleaned-str s})))

(defn parse-DONE [s]
  (let [done-format #"\{\{\[\[DONE\]\]\}\}"
        done-found? (re-find done-format s)]
    (if done-found?
      {:done true
       :cleaned-str (-> s
                     (str/replace done-format "")
                     (str/replace #"\s\%\d{1,3}" ""))}
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
  (-> s
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


      ;; Trim double spaces and whitespace
      (str/replace #"---" "")
      (str/replace #"\s\s" " ")
      (str/trim)))

(defn parse-row-params [block-map settings]
  (let [s (:s block-map)
        cleaned-str (parse-URLs s) ;; remove URLs – it has to start with this, because URLs can contain other markers
        {:keys [custom-color cleaned-str]} (parse-custom-color-1 cleaned-str settings)
        {:keys [range warning cleaned-str]} (parse-time-range cleaned-str)
        {:keys [duration cleaned-str]} (parse-duration cleaned-str settings)
        {:keys [progress cleaned-str]} (parse-progress cleaned-str)
        {:keys [done-at cleaned-str]} (parse-done-time cleaned-str)
        {:keys [done cleaned-str]} (parse-DONE cleaned-str)
        ;; Completed work gets a historical slice only from its explicit
        ;; completion marker.  The Flow core derives its start by subtracting
        ;; the original estimate; it must never use the preceding task's end.
        done-slice (flow-core-call "historicalDoneSlice"
                                   {:done done
                                    :doneAt done-at
                                    :duration duration
                                    :defaultDuration (:default-duration settings)})
        description (parse-rest cleaned-str)
        event-type (if range :meeting :todo)]
    (when done
      (rm-prog-from-block-if-done (:uid block-map)))
    (-> {:description description
         :progress progress
         :duration (int (* (/ (- 100 progress) 100) duration))
         :uid (:uid block-map)
         :start (if done-slice (:start done-slice) (first range))
         :end (if done-slice (:end done-slice) (second range))
         :done done
         :warning warning
         :bg-color custom-color
         :done-at (if done done-at nil)}
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
        scheduler-input (flow-core-call "scheduleTasks"
                                        {:startMinutes workday-start
                                         :endMinutes workday-end
                                         :nowMinutes plan-from-time
                                         :tasks (map #(dissoc % :progress) pending-todos)
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
             :class "nautilus-flow-link-line"
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
   & {:keys [bg-color border-color legend-color legend-rect text timestamp stroke-dasharray font-weight shaky done? uid non-zero-progress? click-to-progress task-start-min task-end-min now-time-atom past?]}]
  (let [start-radians (angle->rad (+ start-angle (shake-if shaky)))
        end-radians (angle->rad (+ end-angle (shake-if shaky)))
        mid-radians (if (and task-start-min task-end-min)
                      (pos-sweep-angle-mid (angle->rad (min->angle task-start-min)) (angle->rad (min->angle task-end-min)))
                      (pos-sweep-angle-mid start-radians end-radians))
        inner-radius (+ inner-radius (shake-if shaky))
        line-outer-radius (if (and task-start-min task-end-min)
                            (+ (outer-radius-at (mod (quot (int (/ (+ task-start-min task-end-min) 2)) 60) (count snail-blueprint-outer-radiuses))) (shake-if shaky))
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
        stroke-dasharray (if (= stroke-dasharray nil) "2,2" stroke-dasharray)
        bg-color (if (= bg-color nil) "rgba(255,255,255,0)" bg-color)
        legend-color (or legend-color (update-opacity-str bg-color "1"))
        font-weight (if font-weight font-weight "normal")
        path (create-arc-path start-angle end-angle inner-radius outer-radius center)
        debug? @debug-state-atom                                       
        dbg-radians-txt (if debug? (str "slc:" (round2 start-radians)  
                                        "–>" (round2 end-radians) "/ leg:" (round2 legend-radians)) "") 
        on-left? (or (<= legend-radians (- (/ pi 2))) (>= legend-radians (/ pi 2)))] 
    [:g {:class (when past? "nautilus-flow-past")}
     [:defs
      [:pattern
       {:id "dot-pattern" :width "4" :height "4" :patternUnits "userSpaceOnUse"}
       [:circle {:r "0.5" :cx "1" :cy "1" :fill "gray"}]
       [:circle {:r "0.5" :cx "5" :cy "5" :fill "gray"}]]]
     (when @debug-state-atom  [:circle {:cx center-x :cy center-y :r 4 :fill "red"}])              
     ;; ⤵ this is the main component - slice
     
     (when non-zero-progress? [:path
      {:d path
       :style {:--pb-delay (str (* (/ (or task-start-min 0) 1440.0) 6.0) "s")}
       :fill "url(#dot-pattern)"}])
     
     [:path
      {:d path
       :class "nautilus-flow-slice"
       :style (merge
                (when click-to-progress {:cursor "pointer"})
                {:--pb-delay (str (* (/ (or task-start-min 0) 1440.0) 6.0) "s")})
       :stroke-dasharray stroke-dasharray
       :fill bg-color
       :on-click #(when click-to-progress (update-block-progress uid 10 now-time-atom))
       ; :on-mouse-enter (fn [_] (reset! hovered true))
       ; :on-mouse-leave (fn [_] (reset! hovered false))
       :stroke border-color}]
     ;; ⤵ adds an event legend
     ;; (when @hovered [:g [:text {:x center-x :y center-y} (str progress)]])
     (when text
       [:g {:style {:--pb-delay (str (* (/ (or task-start-min 0) 1440.0) 6.0) "s")}
             :class "nautilus-flow-slice-group"}
        [:title text]
        [bent-line-component legend-line-start-x legend-line-start-y legend-line-end-x legend-line-end-y legend-color at-vertex? on-left?
         (:connector-knee-x legend-rect) (:connector-rail-x legend-rect)]
        [:text {:x (if at-vertex? legend-line-end-x (+ legend-line-end-x (if on-left? (- bent-line-gap) bent-line-gap))) 
                :y (+ legend-y legend-h)
                :text-anchor (if at-vertex?
                               "middle"
                               (if on-left? "end" "start"))
                :alignment-baseline "baseline"
                :font-weight font-weight
                :style (when click-to-progress {:cursor "pointer"})
                :on-click #(when click-to-progress (update-block-progress uid 10 now-time-atom))
                :text-decoration (if done? "line-through" "none")
                :fill (if-not done? legend-color (update-opacity-str bg-color "0.5"))}
         (if debug? (str dbg-radians-txt)
             (or (flow-core-call "truncateTextToWidth"
                                 {:text text
                                  :maxWidth (* (:legend-len-limit settings) (/ font-size rect-width-coef))
                                  :font (str font-size "px " font-family)})
                 text))
         ]])     
     (when (seq timestamp)
       ;; ⤵ adds a clock label for the snail template
       [:text  {:x time-text-x :y time-text-y :font-size (- font-size 3) :font-family font-family :color border-color :fill border-color
                :transform (str "rotate(" (if
                                           (or (>= start-angle 270)
                                               (<= start-angle 90))
                                            start-angle
                                            (- start-angle 180)) " " time-text-x "," time-text-y ")")
                :text-anchor "middle"
                :alignment-baseline (if
                                     (or (>= start-angle 270)
                                         (<= start-angle 90))
                                      "after-edge"
                                      "before-edge")}
        (if debug? (str (round2 start-radians) " / " start-angle) timestamp)])]))

(defn past-time-overlay-component [inner-radius center settings now-time-atom]
  (let [segments (or (flow-core-call "pastTimelineSegments"
                                     {:startMinutes (:workday-start settings)
                                      :endMinutes (:workday-end settings)
                                      :nowMinutes @now-time-atom})
                     [])]
    [:g {:class "nautilus-flow-past-overlay" :aria-hidden "true"}
     (for [{:keys [start end]} segments]
       ^{:key (str "past:" start ":" end)}
       [:path {:d (create-arc-path
                    (min->angle start)
                    (min->angle end)
                    (spiral-cell-inner-radius start settings inner-radius)
                    (outer-radius-at (mod (quot start 60) (count snail-blueprint-outer-radiuses)))
                    center)}])]))


(defn snail-blueprint-component [color inner-radius center settings daily-page? now-time-atom]
  (let [workday-start (:workday-start settings)
        workday-end (:workday-end settings)
        segments (or (flow-core-call "hourlyGridSegments"
                                     {:startMinutes workday-start
                                      :endMinutes workday-end})
                     [])]
    [:g
     (mapcat (fn [{:keys [start end label]}]
               [[slice
                 [(min->angle start) (min->angle end) (spiral-cell-inner-radius start settings inner-radius)
                  (outer-radius-at (mod (quot start 60) (count snail-blueprint-outer-radiuses)))
                 center settings]
                 :border-color color
                 :past? (and daily-page? (<= end @now-time-atom))
                 :timestamp label]])
             segments)
     (when (= workday-end 1440)
       (let [angle (min->angle workday-end)
             radians (angle->rad angle)
             radius (+ (outer-radius-at (mod 23 (count snail-blueprint-outer-radiuses))) 12)
             x (+ (:center-x center) (* (cos radians) radius))
             y (- (:center-y center) (* (sin radians) radius))]
         [:text {:class "nautilus-flow-midnight-label"
                 :x x :y y :fill color :font-size (- font-size 3)
                 :text-anchor "middle" :alignment-baseline "central"} "0"]))]))

(defn central-label-component [[first-row _] center center-now-label]
  (let [[center-x center-y] [(:center-x center) (:center-y center)]
        common-attr {:x center-x
                     :text-anchor "middle"
                     :dominant-baseline "central"}]
    [:g {:class "nautilus-flow-center-date"}
     [:text (assoc common-attr 
                   :y (- center-y 2) 
                   :fill "var(--nautilus-flow-text-main)"
                   :font-weight "bold" 
                   :font-size (str (* font-size 0.85))) 
       first-row]
     (when center-now-label
       [:text (assoc common-attr
                     :y (+ center-y 13)
                     :class "nautilus-flow-center-now"
                     :fill "var(--nautilus-flow-text-sub)"
                     :font-weight "600"
                     :font-size (str (* font-size 0.82)))
        center-now-label])]))

(defn calculate-slice-params [event index daily-page? now-time-atom]
  (let [outer-radius (outer-radius-at (mod (quot (int (:start event)) 60) (count snail-blueprint-outer-radiuses)))
        start-angle (min->angle (:start event))
        end-angle (min->angle (:end event))
        todo? (:todo event)
        done-at (:done-at event)
        done? (if (:done event) true false)
        meeting? (:meeting event)
        progress (:progress event)
        click-to-progress (if (and daily-page? todo?) true false)
        expired? (and meeting? (>= @now-time-atom (:end event)))
        todo-bg-color (or (:bg-color event ) (nth todo-color-palette (mod index (count todo-color-palette))))
        meeting-color (or (:bg-color event) meeting-fill-color)]
    {:start-angle start-angle
     :end-angle end-angle
     :bg-color (cond
                 meeting? (if (and daily-page? expired?) "rgba(128,128,128,0.1)" meeting-color)
                 todo? (if done-at "rgba(128,128,128,0.1)" todo-bg-color)
                 :else nil)
     :done done?
     :outer-radius outer-radius
     :progress progress
     :meeting? meeting?
     :expired? expired?
     :click-to-progress click-to-progress}))

(defn get-hour-boundaries [start-min end-min]
  (let [first-bound (* (quot (+ start-min 59) 60) 60)
        first-bound (if (<= first-bound start-min) (+ first-bound 60) first-bound)]
    (range first-bound end-min 60)))

(defn event-slice-component [event index legend-rect inner-radius daily-page? center settings now-time-atom conflict?]
  (let [{:keys [bg-color done click-to-progress meeting? expired?]} (calculate-slice-params event index daily-page? now-time-atom)
        legend-color (cond
                       (and meeting? (not expired?) (nil? (:bg-color event))) "var(--nautilus-flow-event)"
                       (and (:todo event) (not done) (nil? (:bg-color event))) task-legend-color
                       :else nil)
        description (:description event)
        uid (:uid event)
        progress (:progress event)
        start-min (:start event)
        end-min (:end event)
        boundaries (get-hour-boundaries start-min end-min)
        segments (loop [curr start-min
                        bounds boundaries
                        segs []]
                   (if (empty? bounds)
                     (if (< curr end-min)
                       (conj segs [curr end-min])
                       segs)
                     (recur (first bounds) (rest bounds) (conj segs [curr (first bounds)]))))]
    (into [:g {:class (str "nautilus-flow-event-slice-group"
                            (when (and daily-page? (:end event) (<= (:end event) @now-time-atom)) " nautilus-flow-past")
                            (when conflict? " nautilus-flow-event-conflict"))}]
          (map-indexed
           (fn [idx [s e]]
             (let [start-angle (min->angle s)
                   end-angle (min->angle e)
                   seg-inner-radius (spiral-cell-inner-radius s settings inner-radius)
                   seg-outer-radius (outer-radius-at (mod (quot (int s) 60) (count snail-blueprint-outer-radiuses)))]
               [slice
                [start-angle end-angle seg-inner-radius seg-outer-radius center settings]
                :bg-color bg-color
                :legend-color legend-color
                :text (if (= idx 0) description nil)
                :shaky shaky
                :done? done
                :uid uid
                :progress progress
                :font-weight "bold"
                :legend-rect (if (= idx 0) legend-rect nil)
                :non-zero-progress? (if (> progress 0) true false)
                :click-to-progress click-to-progress
                :task-start-min start-min
                :task-end-min end-min
                :now-time-atom now-time-atom]))
           segments))))

(defn label-track-map [events]
  (let [labels (mapv #(select-keys % [:uid :start :end]) events)
        placed (or (flow-core-call "placeLabelTracks" {:labels labels :maxTracks 3}) [])]
    (into {} (map (juxt :uid :track) placed))))

(defn events->slices
  "Returns svg vector of all slice components + list of legend rectangles"
  ([events daily-page-atom? center settings now-time-atom]
   (events->slices events daily-page-atom? center settings now-time-atom []))
   ([events daily-page-atom? center settings now-time-atom init-rects]
   (let [events (vec (filter #(not= true (:freetime %)) events))
         track-map (label-track-map events)
         conflict-uids (set (or (flow-core-call "overlappingFixedEventUids" {:events events}) []))]
   (loop [i 0
          events events
          rects init-rects
          all-slice-components [:g]]
    (if-let [event (first events)]
      (let [mid-radians (pos-sweep-angle-mid
                         (angle->rad (min->angle (:start event)))
                         (angle->rad (min->angle (:end event))))
            mid-minute (/ (+ (:start event) (:end event)) 2)
            source-radius (outer-radius-at (mod (quot (int mid-minute) 60) (count snail-blueprint-outer-radiuses)))
            anchor-y (- (:center-y center) (* (sin mid-radians) (+ source-radius 5)))
            text (:description event)
            radius (+ (nth snail-blueprint-outer-radiuses (mod (quot (int (:start event)) 60) (count snail-blueprint-outer-radiuses)))
                      (* 18 (or (get track-map (:uid event)) 0)))
            new-rect (get-legend-rect rects text mid-radians radius center settings (:start event) anchor-y)]
        (println?debug "RADIUS INSIDE EVENTS-SLICES: " radius)              
        (recur (inc i) (rest events) (conj rects new-rect)
               (conj all-slice-components
                     (event-slice-component event i new-rect snail-inner-radius @daily-page-atom? center settings now-time-atom
                                            (contains? conflict-uids (:uid event))))))
      [all-slice-components rects])))))

(defn events->new-dimensions
  "Returns a new center and width so that events can be aligned"
  [events center settings]
  (let [center-x (:center-x center)
        center-y (:center-y center)
        visible-events (vec (filter #(not= true (:freetime %)) events))
        track-map (label-track-map visible-events)]
    (loop [i 0
           events visible-events
           rects []
           left-min (- center-x (outer-radius-at 9))
           right-max (+ center-x (outer-radius-at 14))
           top-min (- center-y (outer-radius-at 11))
           bottom-max (+ center-y (outer-radius-at 17))]
      (if-let [event (first events)]
        (let [mid-radians (pos-sweep-angle-mid
                           (angle->rad (min->angle (:start event)))
                           (angle->rad (min->angle (:end event))))
              mid-minute (/ (+ (:start event) (:end event)) 2)
              source-radius (outer-radius-at (mod (quot (int mid-minute) 60) (count snail-blueprint-outer-radiuses)))
              anchor-y (- (:center-y center) (* (sin mid-radians) (+ source-radius 5)))
              text (:description event)
              radius (+ (nth snail-blueprint-outer-radiuses (mod (quot (int (:start event)) 60) (count snail-blueprint-outer-radiuses)))
                        (* 18 (or (get track-map (:uid event)) 0)))
              new-rect (get-legend-rect rects text mid-radians radius center settings (:start event) anchor-y)]
          (recur (inc i) (rest events) (conj rects new-rect) (min left-min (:x new-rect)) (max right-max (+ (:x new-rect) (:w new-rect))) (min top-min (:y new-rect)) (max bottom-max (+ (:y new-rect) (:h new-rect)))))
        [(+ reserve (- center-x left-min))
         (+ reserve (- right-max left-min))
         (+ reserve (- center-y top-min))
         (+ (* 3 reserve) (- bottom-max top-min) (when (< (:workday-start settings) 420) reserve))])))) ;; when the workday starts before 7:00, the snail has to get more space below

(defn split-and-trim [page-title n]
  (map #(subs % 0 (min n (count %))) (str/split page-title #"," 2)))

(defn compact-item-tone [event]
  (cond
    (:bg-color event) "urgent"
    (:meeting event) "event"
    :else "task"))

(defn compact-event-list [events copy compact-open-state]
  (let [items (->> events
                   (filter #(and (not= true (:freetime %))
                                 (number? (:start %))
                                 (number? (:end %))))
                   (sort-by (juxt :start :end))
                   vec)
        item-label (if (= 1 (count items))
                     (get-in copy [:panels :item])
                     (get-in copy [:panels :items]))]
    [:details {:class "nautilus-flow-compact-details"
               :open @compact-open-state
               :on-toggle #(let [next-open? (.-open (.-currentTarget %))]
                             (when (not= next-open? @compact-open-state)
                               (reset! compact-open-state next-open?)))}
     [:summary {:class "nautilus-flow-compact-summary"}
      (str (get-in copy [:panels :schedule]) " · " (count items) " " item-label)]
     [:ol {:class "nautilus-flow-compact-list"
           :aria-label "Nautilus Flow scheduled items"}
      (for [[index event] (map-indexed vector items)]
        ^{:key (str (:uid event) ":" (:start event) ":" index)}
        [:li {:class (str "nautilus-flow-compact-item"
                          (when (:done event) " nautilus-flow-compact-item--done"))
              :title (:description event)}
         [:i {:class (str "nautilus-flow-compact-dot nautilus-flow-compact-dot--" (compact-item-tone event))
              :aria-hidden "true"}]
         [:time {:class "nautilus-flow-compact-time"}
          (str (minutes->time (:start event)) "–" (minutes->time (:end event)))]
         [:span {:class "nautilus-flow-compact-title"} (:description event)]])]]))

(defn show-events [events-state daily-page-atom? show-done-atom? playback-state-atom now-time-atom page-title dimensions settings compact? copy compact-open-state]
  (let [[events done-todos] events-state
        old-width (js/Math.round (:width dimensions))
        old-height (js/Math.round (:height dimensions))
        all-events-for-dim (vec (if @show-done-atom? (concat events done-todos) events))
        [center-x suggested-width center-y suggested-height]
        (if compact?
          [(/ old-width 2) old-width (/ old-height 2) old-height]
          (events->new-dimensions all-events-for-dim {:center-x (/ old-width 2) :center-y (/ old-height 2)} settings))
        center {:center-x center-x :center-y center-y}
        [all-slice-components rects] (events->slices events daily-page-atom? center settings now-time-atom)
        done-slices-and-rects (when @show-done-atom?
                                (events->slices done-todos daily-page-atom? center settings now-time-atom rects))
        done-slice-components (first done-slices-and-rects)
        rects (or (second done-slices-and-rects) rects)
        now-visible? (and (or @daily-page-atom? @playback-state-atom)
                          (>= @now-time-atom (:workday-start settings))
                          (< @now-time-atom (:workday-end settings)))
        center-now-label (when now-visible? (minutes->time @now-time-atom))]
    [:div {:class (str "nautilus-flow-visual" (when compact? " nautilus-flow-visual--compact"))}
     [:svg {:viewBox (str "0 0 " suggested-width " " suggested-height)
           :width "100%"
           :style {:max-width (str suggested-width "px")}
           :xmlns "http://www.w3.org/2000/svg"
           :class (str "nautilus-flow-svg" (when @playback-state-atom " nautilus-flow-playback-active"))
           :font-family font-family
           :font-size font-size}
     [:g
      (when (or @daily-page-atom? @playback-state-atom)
        [past-time-overlay-component snail-inner-radius center settings now-time-atom])
      (when @show-done-atom? done-slice-components)
      all-slice-components         ;; zobrazení všech událostí
      [snail-blueprint-component snail-template-color snail-inner-radius center settings @daily-page-atom? now-time-atom]
      (when now-visible?
        (let [visible-now @now-time-atom
              now-angle (min->angle visible-now)
              now-rad (angle->rad now-angle)
              inner-r (+ snail-inner-radius 2)
              max-r (apply max snail-blueprint-outer-radiuses)
              x1 (+ (:center-x center) (* inner-r (js/Math.cos now-rad)))
              y1 (- (:center-y center) (* inner-r (js/Math.sin now-rad)))
              x2 (+ (:center-x center) (* (+ max-r 15) (js/Math.cos now-rad)))
              y2 (- (:center-y center) (* (+ max-r 15) (js/Math.sin now-rad)))
              label (minutes->time visible-now)
              now-copy (get-in copy [:capacity :now])
              label-aria (str now-copy " " label)]
          [:g {:class "nautilus-flow-now-needle" :aria-label label-aria}
           [:line {:x1 x1 :y1 y1 :x2 x2 :y2 y2
                   :stroke clock-hand-color
                   :stroke-width 2
                   :stroke-linecap "round"
                   :class "nautilus-flow-now-needle-line"
                   :style {:filter "drop-shadow(0px 0px 4px rgba(233, 79, 79, 0.4))"}}]]))
      [central-label-component (split-and-trim page-title len-central-legend) center center-now-label]
     
      (when @debug-state-atom ;; just for debug ⤵  #FIXME remove in production later
        [:g                                                             
         [draw-debug-rects rects]                                       
         [:text {:x "0" :y "450" :text-anchor "start"}                  
          "Suggested w: " suggested-width                               
          " Center-x: " (:center-x center)                              
          " Center-y: " (js/Math.round center-y)]                       
         [:circle {:cx (:center-x center) :cy (:center-y center)        
                   :r 200 :fill "none" :stroke "black" :stroke-width 1}]])]]
     [compact-event-list all-events-for-dim copy compact-open-state]]))

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

(defn get-children-pull [block-uid]
  (rdr/pull
    [{:block/children [:block/uid :block/string :block/order {:block/refs [:block/string :block/uid]}]}]
    [:block/uid block-uid]))

(defn reset-now-time-atom [now-time-atom]
  (reset! now-time-atom
          (let [now (new js/Date (.now js/Date))
                minutes (+ (* (.getHours now) 60) (.getMinutes now))]
            minutes)))

(defn switch-done-visibility-button [show-done-state copy]
  [:button
   {:on-click #(swap! show-done-state not)
    :class "nautilus-flow-toggle-btn"
    :title (if @show-done-state (:hideDone copy) (:showDone copy))
    :aria-label (if @show-done-state (:hideDone copy) (:showDone copy))}
   (if @show-done-state
     [:svg {:width "16" :height "16" :viewBox "0 0 24 24" :fill "none" :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"}
      [:path {:d "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"}]
      [:circle {:cx "12" :cy "12" :r "3"}]]
     [:svg {:width "16" :height "16" :viewBox "0 0 24 24" :fill "none" :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"}
      [:path {:d "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"}]
      [:line {:x1 "1" :y1 "1" :x2 "23" :y2 "23"}]])])

(defn collapse-storage-key [block-uid]
  (str "nautilus-flow:collapsed:v1:" block-uid))

(defn read-collapsed-state [block-uid]
  (try
    (= "true" (.getItem js/localStorage (collapse-storage-key block-uid)))
    (catch :default _e false)))

(defn write-collapsed-state [block-uid value]
  (try
    (.setItem js/localStorage (collapse-storage-key block-uid) (str value))
    (catch :default _e nil)))

(defn collapse-button [collapsed-state block-uid copy]
  [:button
   {:on-click #(let [next (not @collapsed-state)]
                 (reset! collapsed-state next)
                 (write-collapsed-state block-uid next))
    :class "nautilus-flow-toggle-btn nautilus-flow-collapse-btn"
    :title (if @collapsed-state (:expand copy) (:collapse copy))
    :aria-label (if @collapsed-state (:expand copy) (:collapse copy))}
   [:svg {:width "18" :height "18" :viewBox "0 0 24 24" :fill "none"
          :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"
          :aria-hidden "true"}
    [:rect {:x "3" :y "4" :width "18" :height "16" :rx "2.5"}]
    [:path {:d "M3 9h18"}]
    [:path {:d (if @collapsed-state "m9 13 3 3 3-3" "m9 16 3-3 3 3")}]]])

(defn playback-button [settings now-time-atom playback-state-atom playback-frame-atom copy]
  [:button
   {:on-click #(when-not @playback-state-atom
                 (reset! playback-state-atom true)
                 (let [start-time (js/performance.now)
                       duration 6000.0]
                   (letfn [(tick [now]
                             (let [elapsed (- now start-time)
                                   progress (min 1.0 (/ elapsed duration))
                                   w-start (:workday-start settings)
                                   simulated-minute (int (+ w-start (* progress (- (:workday-end settings) w-start))))]
                               (reset! now-time-atom simulated-minute)
                               (if (< progress 1.0)
                                 (reset! playback-frame-atom (js/requestAnimationFrame tick))
                                 (do
                                   (reset! playback-frame-atom nil)
                                   (reset! playback-state-atom false)
                                   (reset-now-time-atom now-time-atom)))))]
                     (reset! playback-frame-atom (js/requestAnimationFrame tick)))))
    :class "nautilus-flow-toggle-btn"
    :title (:playback copy)
    :aria-label (:playback copy)
    :disabled @playback-state-atom}
   [:svg {:width "16" :height "16" :viewBox "0 0 24 24" :fill "none" :stroke "currentColor" :stroke-width "2" :stroke-linecap "round" :stroke-linejoin "round"}
    [:polygon {:points "5 3 19 12 5 21 5 3"}]]])

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

(def settings-event-name "nautilus-flow:settings-changed")

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
        normalized (or (flow-core-call "normalizeScheduleSettings"
                                       {:startHour (or a3 (/ init-workday-start 60))
                                        :endHour (or a5 (/ init-workday-end 60))})
                       {:startHour 5 :endHour 24 :startMinutes 300 :endMinutes 1440})]
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
    (if-let [settings (some-> js/window .-nautilusFlowExtensionData .-settings)]
      (js->clj settings :keywordize-keys true)
      {})
    (catch :default _e {})))

(defn resolve-render-settings [args]
  (let [values (render-arg-values args)
        values (if (> (count values) 3)
                 (assoc values 3 (arg-tag->str (nth values 3)))
                 values)]
    (or (flow-core-call "resolveRendererSettings"
                        {:runtime (extension-runtime-settings)
                         :args values})
        (args->settings values))))

(defn ui-copy [settings]
  (or (flow-core-call "uiCopy" (:language settings))
      {:capacity {:available "Available" :events "Events" :demand "Demand" :overload "Overload" :fragmented "No fitting slot" :remaining "Remaining"
                  :burningAvailable "Flexible time is elapsing" :burningEvents "Event time is elapsing" :now "Current time"}
       :legend {:urgent "Urgent" :event "Event" :task "Task"}
       :controls {:hideDone "Hide completed items" :showDone "Show completed items" :playback "Play back the day"
                  :collapse "Collapse Nautilus Flow" :expand "Expand Nautilus Flow"}
       :panels {:overview "Overview" :overflow "Unscheduled today" :warnings "Schedule warnings" :schedule "Schedule" :item "item" :items "items"}
       :warnings {:overnight "Overnight events display only through 24:00"
                  :sameTime "Start and end times cannot be the same"}}))

(defn capacity-metrics [capacity settings]
  (or (flow-core-call "capacityMetrics" {:capacity capacity :language (:language settings)})
      [{:key "available" :label "Available" :value "0m" :tone "neutral"}
       {:key "events" :label "Events" :value "0m" :tone "event"}
       {:key "demand" :label "Demand" :value "0m" :percent "0%" :percentTone "neutral" :tone "neutral"}
       {:key "remaining" :label "Remaining" :value "0m" :tone "neutral"}]))

(defn burning-flame-icon [label]
  [:svg {:class "nautilus-flow-burning-icon"
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

(defn metrics-component [metrics]
  (let [aria-label (str/join ", " (map #(str (:label %) " " (:value %)
                                             (when-let [percent (:percent %)] (str ", " percent))
                                             (when (:burning %)
                                               (str ", " (:burningLabel %)))) metrics))]
    [:div {:class "nautilus-flow-metrics" :aria-label aria-label}
     (for [metric metrics]
       ^{:key (:key metric)}
       [:div {:class (str "nautilus-flow-metric nautilus-flow-metric--" (:tone metric))}
        [:span {:class "nautilus-flow-metric-label"} (:label metric)]
        [:span {:class "nautilus-flow-metric-reading"
                :aria-label (when (:burning metric)
                              (str (:value metric) ". " (:burningLabel metric)))}
         [:strong {:class "nautilus-flow-metric-value"} (:value metric)]
         (when (:burning metric)
           [burning-flame-icon (:burningLabel metric)])
         (when-let [percent (:percent metric)]
           [:span {:class (str "nautilus-flow-metric-percent nautilus-flow-metric-percent--" (:percentTone metric))}
            (str "/ " percent)])]])]))

(defn capacity-metrics-component [capacity settings]
  [metrics-component (capacity-metrics capacity settings)])

(defn html-legend-component [copy]
  [:div {:class "nautilus-flow-html-legend" :aria-label "Nautilus Flow legend"}
   [:span {:class "nautilus-flow-legend-item"}
    [:i {:class "nautilus-flow-legend-dot nautilus-flow-legend-dot--urgent" :aria-hidden "true"}]
    (get-in copy [:legend :urgent])]
   [:span {:class "nautilus-flow-legend-item"}
    [:i {:class "nautilus-flow-legend-dot nautilus-flow-legend-dot--event" :aria-hidden "true"}]
    (get-in copy [:legend :event])]
   [:span {:class "nautilus-flow-legend-item"}
    [:i {:class "nautilus-flow-legend-dot nautilus-flow-legend-dot--task" :aria-hidden "true"}]
    (get-in copy [:legend :task])]])

(defn compact-overview-component [capacity settings copy compact-open-state]
  (let [metrics (capacity-metrics capacity settings)
        status (last metrics)
        warning? (= "warning" (:tone status))
        burning-bucket (:burningBucket capacity)
        burning-label (case burning-bucket
                        "available" (get-in copy [:capacity :available])
                        "events" (get-in copy [:capacity :events])
                        nil)
        burning-aria (case burning-bucket
                       "available" (get-in copy [:capacity :burningAvailable])
                       "events" (get-in copy [:capacity :burningEvents])
                       nil)
        summary-aria (str (get-in copy [:panels :overview])
                          (when burning-label (str ". " burning-label ". " burning-aria))
                          (when warning? (str ". " (:label status) " " (:value status))))]
    [:details {:class (str "nautilus-flow-compact-overview"
                           (when warning? " nautilus-flow-compact-overview--warning"))
               :open @compact-open-state
               :on-toggle #(let [next-open? (.-open (.-currentTarget %))]
                             (when (not= next-open? @compact-open-state)
                               (reset! compact-open-state next-open?)))}
     [:summary {:class "nautilus-flow-compact-summary nautilus-flow-compact-overview-summary"
                :aria-label summary-aria}
      [:span {:class "nautilus-flow-compact-overview-summary-content"}
       (get-in copy [:panels :overview])
       (when burning-label
         [:span {:class "nautilus-flow-burning-summary"}
          " · "
          [burning-flame-icon burning-aria]
          " "
          burning-label])]
      (when warning?
        [:span {:class "nautilus-flow-compact-overview-warning"}
         (str " · " (:label status) " " (:value status))])]
     [:div {:class "nautilus-flow-compact-overview-body"}
      [metrics-component metrics]
      [html-legend-component copy]]]))

(defn localized-warning [warning copy]
  (case warning
    "跨日事件仅显示至 24:00" (get-in copy [:warnings :overnight])
    "开始时间与结束时间不能相同" (get-in copy [:warnings :sameTime])
    warning))

(defn overflow-panel [capacity copy]
  (let [overflow (:overflowTasks capacity)
        count-overflow (count overflow)
        total (:unplacedMinutes capacity)
        item-label (if (= count-overflow 1) (get-in copy [:panels :item]) (get-in copy [:panels :items]))]
    (when (pos? count-overflow)
      [:details {:class "nautilus-flow-overflow-panel"}
       [:summary (str (get-in copy [:panels :overflow]) " · " (or (flow-core-call "formatDuration" total) "0m") " · " count-overflow " " item-label)]
       [:ul
        (for [task overflow]
          ^{:key (:uid task)} [:li
                               [:span (:description task)]
                               [:span {:class "nautilus-flow-overflow-duration"}
                                (or (flow-core-call "formatDuration" (:duration task)) "0m")]])]])))

(defn schedule-warning-panel [events copy]
  (let [warnings (vec (filter :warning events))]
    (when (seq warnings)
      [:details {:class "nautilus-flow-warning-panel"}
       [:summary (str (get-in copy [:panels :warnings]) " · " (count warnings) " "
                      (if (= 1 (count warnings)) (get-in copy [:panels :item]) (get-in copy [:panels :items])))]
       [:ul
        (for [event warnings]
          ^{:key (:uid event)}
          [:li
           [:span (:description event)]
           [:span {:class "nautilus-flow-warning-message"} (localized-warning (:warning event) copy)]])]])))

(defn flow-controls [show-done-state settings now-time-atom playback-state-atom playback-frame-atom collapsed-state block-uid copy show-debug-button?]
  [:div {:class "nautilus-flow-controls-top"}
   [switch-done-visibility-button show-done-state (:controls copy)]
   [playback-button settings now-time-atom playback-state-atom playback-frame-atom (:controls copy)]
   [collapse-button collapsed-state block-uid (:controls copy)]
   (when show-debug-button? [switch-debug-button])])

(defn render-context-probe [render-context-state compact-list-open-state]
  [:span
   {:class "nautilus-flow-context-probe"
    :aria-hidden "true"
    :ref (fn [node]
           (when node
             (let [suppress? (try
                               (if-let [detector (.-shouldSuppressRenderContext js/window.nautilusFlowExtensionData)]
                                 (boolean (detector node))
                                 false)
                               (catch :default _e false))
                   sidebar? (try
                              (if-let [detector (.-isRightSidebarRenderContext js/window.nautilusFlowExtensionData)]
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
                 (reset! render-context-state next-state)))))}])

(defn compact-chart-width? [width]
  (boolean (flow-core-call "isCompactChartWidth" width)))

(defn observe-compact-width! [node compact-state resize-observer-state]
  (when-let [current-observer @resize-observer-state]
    (.disconnect current-observer)
    (reset! resize-observer-state nil))
  (when node
    (let [update-width! (fn [width]
                          (let [next-state (compact-chart-width? width)]
                            (when (not= @compact-state next-state)
                              (reset! compact-state next-state))))]
      (update-width! (.-width (.getBoundingClientRect node)))
      (when (.-ResizeObserver js/window)
        (let [observer (js/ResizeObserver.
                        (fn [entries]
                          (when-let [entry (aget entries 0)]
                            (update-width! (.-width (.-contentRect entry))))))]
          (.observe observer node)
          (reset! resize-observer-state observer))))))

(defn main [{:keys [:block-uid]} & args]
  (r/with-let [is-running? #(try
                              (boolean (.-running js/window.nautilusFlowExtensionData))
                              (catch :default _e false))
               *running? (r/atom (or (is-running?) nil))
               check-interval (js/setInterval #(reset! *running? (is-running?)) 5000)
               settings-state (r/atom (resolve-render-settings args))
               settings-listener (fn [_event]
                                   (reset! settings-state (resolve-render-settings args)))
               _settings-listener (.addEventListener js/window settings-event-name settings-listener)
               now-time-atom (r/atom (now-minutes))
               playback-state-atom (r/atom false)
               playback-frame-atom (r/atom nil)
               collapsed-state (r/atom (read-collapsed-state block-uid))
               render-context-state (r/atom :pending)
               compact-list-open-state (r/atom nil)
               compact-overview-open-state (r/atom false)
               compact-state (r/atom false)
               resize-observer-state (atom nil)
               container-ref (fn [node]
                               (observe-compact-width! node compact-state resize-observer-state))
               clock-interval (js/setInterval #(when-not @playback-state-atom
                                                 (reset-now-time-atom now-time-atom)) 60000)
               *get-children-atom (get-children-pull block-uid)
               *children (r/track eval-state *get-children-atom)
               *text-events (r/track
                             (fn []
                               (let [settings @settings-state
                                     children-list (->> @*children
                                                        (filter #(not= "" (:block/string %)))
                                                        (sort-by :block/order))
                                     mapped (mapv #(hash-map :s (str-with-resolved-block-refs %) :uid (:block/uid %)) children-list)
                                     parsed (mapv #(parse-row-params % settings) mapped)
                                     filtered (filterv #(not= "" (:description %)) parsed)]
                                 (let [dones (filterv #(or (:done-at %) (and (:meeting %) (:done %))) filtered)
                                       pendings (filterv #(not (or (:done-at %) (and (:meeting %) (:done %)))) filtered)]
                                   [(add-start-after pendings) dones]))))
               show-done-state (r/atom true)
               daily-page-atom? (r/atom (daily-page? block-uid))
               page-title-val (page-title block-uid)]
    (case @*running?
      nil [:div {:class "nautilus-flow-loading"} [:strong "Loading Nautilus Flow..."]]
      false [:div {:class "nautilus-flow-not-installed"}
             [:strong {:style {:color "red"}} "Extension not installed. To use Nautilus Flow, install it from Roam Depot."]]
      (cond
        (= :pending @render-context-state)
        [render-context-probe render-context-state compact-list-open-state]

        (= :suppressed @render-context-state)
        [:span {:class "nautilus-flow-context-probe" :aria-hidden "true"}]

        :else
        (do
          (when-not @playback-state-atom (reset-now-time-atom now-time-atom))
          (let [settings @settings-state
                copy (ui-copy settings)
                dimensions {:width (if mobile? mob-width desk-width)
                            :height (* start-svg-rect-ratio (if mobile? mob-width desk-width))}
                show-debug-button? (= :debug (first args))
                plan-from-time (if @daily-page-atom?
                                 (if @playback-state-atom (:workday-start settings) @now-time-atom)
                                 (:workday-start settings))
                [text-events done-events] @*text-events
                pending-tasks (vec (filter #(and (:todo %) (not (:done %))) text-events))
                fixed-events (vec (filter #(and (:meeting %) (not (:done %))) text-events))
                capacity-base (or (flow-core-call "calculateCapacity"
                                                   {:startMinutes (:workday-start settings)
                                                    :endMinutes (:workday-end settings)
                                                    :nowMinutes (if @playback-state-atom @now-time-atom plan-from-time)
                                                    :fixedEvents fixed-events
                                                    :pendingTasks (map #(dissoc % :progress) pending-tasks)})
                                  {:availableMinutes 0 :fixedMinutes 0 :demandMinutes 0 :overloadMinutes 0 :slackMinutes 0 :unplacedMinutes 0 :overflowTasks []})
                burning-bucket (flow-core-call "burningCapacityBucket"
                                               {:startMinutes (:workday-start settings)
                                                :endMinutes (:workday-end settings)
                                                :nowMinutes @now-time-atom
                                                :fixedEvents fixed-events})
                capacity (assoc capacity-base :burningBucket burning-bucket)
                events-state [(fill-day text-events (:workday-start settings) (:workday-end settings) plan-from-time) done-events]]
            [:div {:class (str "nautilus-flow-container" (when @collapsed-state " nautilus-flow-collapsed"))
                   :ref container-ref
                   :data-nautilus-flow-block block-uid}
             (if @collapsed-state
               [flow-controls show-done-state settings now-time-atom playback-state-atom playback-frame-atom collapsed-state block-uid copy show-debug-button?]
               [:div {:class "nautilus-flow-shell"}
                [:header {:class (str "nautilus-flow-header"
                                     (when @compact-state " nautilus-flow-header--compact"))}
                 [:div {:class "nautilus-flow-header-copy"}
                  [capacity-metrics-component capacity settings]]
                 [:div {:class "nautilus-flow-header-actions"}
                  [flow-controls show-done-state settings now-time-atom playback-state-atom playback-frame-atom collapsed-state block-uid copy show-debug-button?]
                  [html-legend-component copy]]]
                (when @compact-state
                  [compact-overview-component capacity settings copy compact-overview-open-state])
                [:div {:class "nautilus-flow-content"}
                 [show-events events-state daily-page-atom? show-done-state playback-state-atom now-time-atom page-title-val dimensions settings @compact-state copy compact-list-open-state]
                 [overflow-panel capacity copy]
                 [schedule-warning-panel text-events copy]]])]))))
    (finally
      (js/clearInterval check-interval)
      (js/clearInterval clock-interval)
      (.removeEventListener js/window settings-event-name settings-listener)
      (when-let [resize-observer @resize-observer-state]
        (.disconnect resize-observer))
      (when @playback-frame-atom
        (js/cancelAnimationFrame @playback-frame-atom)))))
